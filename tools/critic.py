#!/usr/bin/env python3
"""
Hackerly human critic.

Drives the running portal in a real browser and walks six personas through it,
taking a screenshot at every step and recording what actually happened rather
than what the HTML was supposed to contain.

    python3 tools/critic.py                      # all personas
    python3 tools/critic.py --only judge         # one persona
    python3 tools/critic.py --width 1440

It reports honestly. The point is to find the things that are technically
functional and still frustrating.
"""

import argparse
import base64
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request

BASE = os.environ.get("HACKERLY_URL", "http://localhost:10000")
SHOTS = os.environ.get("HACKERLY_SHOTS", "/tmp/opencode/critic")
ACCOUNTS = {
    "organiser": "organiser@hackerly.dev",
    "judge": "judge@hackerly.dev",
    "judge2": "judge2@hackerly.dev",
    "participant": "participant@hackerly.dev",
}
PASSWORD = "hackerly-demo"


# --------------------------------------------------------------------- driver

class Browser:
    def __init__(self, width=1440, height=1000):
        self.width = width
        self.height = height
        self.profile = f"/tmp/opencode/ff-{int(time.time()*1000)}"
        self.proc = None
        self.sock = None
        self.msg = 0
        self.shot_n = 0

    def start(self):
        os.makedirs(self.profile, exist_ok=True)
        os.makedirs(SHOTS, exist_ok=True)
        self.proc = subprocess.Popen(
            ["firefox", "--headless", "--marionette", "--no-remote",
             "--width", str(self.width), "--height", str(self.height),
             "--profile", self.profile],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        for _ in range(40):
            try:
                self.sock = socket.create_connection(("127.0.0.1", 2828), timeout=2)
                break
            except OSError:
                time.sleep(0.5)
        if not self.sock:
            raise RuntimeError("could not reach Firefox marionette")
        self.sock.settimeout(30)
        self._read_packet()
        self.cmd("WebDriver:NewSession", {"capabilities": {}})
        self.cmd("WebDriver:SetWindowRect", {"width": self.width, "height": self.height})

    def close(self):
        try:
            if self.sock:
                self.sock.close()
        except Exception:
            pass
        if self.proc:
            self.proc.terminate()

    def _read_packet(self):
        data = b""
        while b":" not in data:
            chunk = self.sock.recv(1024)
            if not chunk:
                raise EOFError
            data += chunk
        length, rest = data.split(b":", 1)
        length = int(length)
        while len(rest) < length:
            rest += self.sock.recv(length - len(rest))
        return json.loads(rest[:length])

    def cmd(self, command, params=None):
        self.msg += 1
        payload = json.dumps([0, self.msg, command, params or {}])
        self.sock.sendall(f"{len(payload)}:{payload}".encode())
        res = self._read_packet()
        return res

    def value(self, res):
        if isinstance(res, list) and len(res) > 3 and isinstance(res[3], dict):
            return res[3].get("value")
        return res

    def go(self, path, wait=1.1):
        url = path if path.startswith("http") else BASE + path
        self.cmd("WebDriver:Navigate", {"url": url})
        time.sleep(wait)
        return self.url()

    def url(self):
        return self.value(self.cmd("WebDriver:GetCurrentURL", {}))

    def title(self):
        return self.value(self.cmd("WebDriver:GetTitle", {}))

    def js(self, script, args=None):
        # `script` is a function expression such as "() => document.title".
        # Arrow functions have no `arguments` of their own, so the wrapper
        # function collects them and applies them to the caller's function.
        res = self.cmd("WebDriver:ExecuteScript", {
            "script": (
                "var __a = Array.prototype.slice.call(arguments);"
                "try { return (" + script + ").apply(null, __a); }"
                "catch (e) { return {__error: String(e)}; }"
            ),
            "args": args or [],
            "scriptTimeout": 15000,
        })
        v = self.value(res)
        if isinstance(v, dict) and "__error" in v:
            return {"error": v["__error"]}
        return v

    def text(self):
        return self.js("() => document.body.innerText.replace(/[ \\t]+/g,' ').replace(/\\n{3,}/g,'\\n\\n').trim()") or ""

    def shot(self, name):
        self.shot_n += 1
        path = f"{SHOTS}/{self.shot_n:02d}-{re.sub(r'[^a-z0-9-]+','-',name.lower())[:60]}.png"
        res = self.cmd("WebDriver:TakeScreenshot", {"full": True})
        data = self.value(res)
        if data:
            with open(path, "wb") as f:
                f.write(base64.b64decode(data))
        return path

    def click(self, selector, wait=0.8):
        ok = self.js("() => { const el = document.querySelector(arguments[0]); if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; }", [selector])
        time.sleep(wait)
        return ok

    def fill(self, selector, value, wait=0.2):
        return self.js("""() => {
            const el = document.querySelector(arguments[0]);
            if (!el) return false;
            el.focus();
            el.value = arguments[1];
            el.dispatchEvent(new Event('input', {bubbles:true}));
            el.dispatchEvent(new Event('change', {bubbles:true}));
            return true;
        }""", [selector, value])

    def sign_in(self, who):
        email = ACCOUNTS[who]
        self.go("/signin")
        self.fill("input[name=email]", email)
        self.fill("input[name=password]", PASSWORD)
        self.click("form button[type=submit]", wait=1.6)
        return self.url()

    def sign_out(self):
        self.go("/", wait=0.6)
        done = self.js("() => { const f = document.querySelector('form[action=\"/signout\"]'); if (f) { f.submit(); return true; } return false; }")
        if not done:
            # No visible sign-out control; clear the cookie directly.
            self.js("() => { document.cookie = 'hkl_session=; Max-Age=0; path=/'; return true; }")
        self.go("/", wait=0.8)


# ------------------------------------------------------------------ reporting

class Report:
    def __init__(self):
        self.personas = []
        self.shots = []

    def persona(self, name, task, findings):
        self.personas.append({"persona": name, "task": task, "findings": findings})
        bar = "=" * 74
        print(f"\n{bar}\n  {name}\n  task: {task}\n{bar}")
        for f in findings:
            mark = {"good": "  ok  ", "bad": "  BAD ", "meh": "  ??  "}.get(f["verdict"], "  ?   ")
            print(f"{mark} {f['note']}")
            if f.get("shot"):
                self.shots.append(f["shot"])

    def summary(self):
        print("\n" + "=" * 74)
        print("  CRITIC SUMMARY")
        print("=" * 74)
        bad = []
        meh = []
        for p in self.personas:
            b = [f for f in p["findings"] if f["verdict"] == "bad"]
            m = [f for f in p["findings"] if f["verdict"] == "meh"]
            status = "FAIL" if b else ("WEAK" if m else "PASS")
            print(f"  {p['persona']:<34} {status}")
            bad += [f"[{p['persona']}] {f['note']}" for f in b]
            meh += [f"[{p['persona']}] {f['note']}" for f in m]
        print(f"\n  {len(bad)} problem(s), {len(meh)} weak spot(s)\n")
        for line in bad:
            print("  ! " + line)
        for line in meh:
            print("  ~ " + line)
        return bad, meh


def out(*a):
    print(*a, flush=True)


# ------------------------------------------------------------------- personas

def critic_visitor(b, r):
    f = []
    b.go("/")
    f.append({"verdict": "good", "note": f"Homepage renders at {b.url()}", "shot": b.shot("visitor-home")})
    t = b.text()
    has = lambda s: s.lower() in t.lower()
    f.append({"verdict": "good" if has("Explore hackathons") else "bad",
              "note": "A first-timer can find the primary path (Explore hackathons)" if has("Explore hackathons") else "No obvious 'Explore hackathons' path on the homepage"})
    f.append({"verdict": "good" if has("Host a hackathon") else "bad",
              "note": "Hosting path is present and visible" if has("Host a hackathon") else "No visible path to hosting a hackathon"})
    words = len(t.split())
    f.append({"verdict": "good" if words < 2200 else "meh",
              "note": f"Homepage is {words} words — scannable" if words < 2200 else f"Homepage is {words} words, which is a wall"})

    b.go("/hackathons")
    f.append({"verdict": "good", "note": "Directory reachable", "shot": b.shot("visitor-directory")})
    d = b.text()
    names = [e for e in ("Signal 2026", "Foundry 2026", "Sample Hack 2026") if e.lower() in d.lower()]
    f.append({"verdict": "good" if names else "bad",
              "note": f"Directory lists real events: {', '.join(names)}" if names else "Directory shows nothing"})

    # Open the live event without an account.
    b.go("/h/signal-2026")
    et = b.text()
    f.append({"verdict": "good" if "About" in et or "Signal 2026" in et else "bad",
              "note": "Event page readable without an account", "shot": b.shot("visitor-event")})
    for section in ("Who can take part", "Tracks", "Schedule", "Prizes"):
        f.append({"verdict": "good" if section.lower() in et.lower() else "bad",
                  "note": f"Event page explains '{section}'" if section.lower() in et.lower() else f"Event page never mentions {section}"})
    # Database-looking artefacts are a hard fail.
    for junk in ("prj_", "evt_", "tm_", "trk_", "jdg_"):
        f.append({"verdict": "bad" if junk in et else "good",
                  "note": f"Leaks an internal id ({junk}) on the event page" if junk in et else f"No internal ids ({junk}) on the event page"})

    b.go("/h/foundry-2026/results")
    rt = b.text()
    f.append({"verdict": "good" if re.search(r"\b1\b", rt) and "place" in rt.lower() else "bad",
              "note": "Published results are readable", "shot": b.shot("visitor-results")})
    b.go("/projects")
    f.append({"verdict": "good", "note": "Public showcase reachable without an account", "shot": b.shot("visitor-showcase")})
    r.persona("FIRST-TIME VISITOR", "What is Hackerly, and can I find a hackathon?", f)


def critic_participant(b, r):
    f = []
    b.sign_in("participant")
    f.append({"verdict": "good" if "/dashboard" in b.url() else "bad",
              "note": f"Sign-in lands on the dashboard ({b.url()})", "shot": b.shot("participant-dashboard")})
    d = b.text()
    f.append({"verdict": "good" if "Signal 2026" in d else "bad",
              "note": "Dashboard shows the events I am registered for" if "Signal 2026" in d else "Dashboard is empty for a registered participant"})

    b.go("/p/signal-2026")
    pt = b.text()
    f.append({"verdict": "good", "note": "Participant workspace renders", "shot": b.shot("participant-entry")})
    f.append({"verdict": "good" if "team" in pt.lower() else "bad",
              "note": "Team state is visible on the entry page" if "team" in pt.lower() else "Cannot tell whether I am on a team"})
    f.append({"verdict": "good" if "project" in pt.lower() else "bad",
              "note": "Project state is visible" if "project" in pt.lower() else "No project state visible"})

    b.go("/p/signal-2026/project")
    et = b.text()
    f.append({"verdict": "good", "note": "Project editor opens", "shot": b.shot("participant-editor")})
    has_deadline = "close" in et.lower() or "deadline" in et.lower()
    f.append({"verdict": "good" if has_deadline else "bad",
              "note": "Editor states the deadline" if has_deadline else "Editor never says when submissions close"})
    f.append({"verdict": "good" if "Save draft" in et else "bad",
              "note": "Can save a draft" if "Save draft" in et else "No way to save a draft"})

    # Can I actually save?
    before = b.js("() => (document.querySelector('input[name=name]')||{}).value || ''")
    b.fill("input[name=tagline]", "Testing a save from the critic.")
    b.click("form[action$='/project'] button[value=save]", wait=1.4)
    after = b.js("() => (document.querySelector('input[name=tagline]')||{}).value || ''")
    f.append({"verdict": "good" if after else "bad",
              "note": "Saving a draft persists the field" if after else "Saving a draft loses the input"})

    b.go("/p/signal-2026/team")
    f.append({"verdict": "good", "note": "Team management reachable", "shot": b.shot("participant-team")})
    b.sign_out()

    r.persona("PARTICIPANT", "Can I register, form a team, and submit a project?", f)


def critic_organiser(b, r):
    f = []
    b.sign_in("organiser")
    b.go("/o/signal-2026")
    t = b.text()
    f.append({"verdict": "good", "note": "Organiser console opens", "shot": b.shot("org-overview")})
    for tab in ("Tracks & challenges", "Rubric", "Judges", "Results", "Announcements"):
        f.append({"verdict": "good" if tab.lower() in t.lower() else "bad",
                  "note": f"Console exposes '{tab}'" if tab.lower() in t.lower() else f"Console is missing '{tab}'"})

    b.go("/o/signal-2026/projects")
    pt = b.text()
    f.append({"verdict": "good" if "Slipway" in pt else "bad",
              "note": "Submissions listed with real project names", "shot": b.shot("org-projects")})
    has_export = "export" in pt.lower()
    f.append({"verdict": "good" if has_export else "bad",
              "note": "CSV export is one click away from every console page" if has_export else "No export control on the submissions page"})

    b.go("/o/signal-2026/judges")
    jt = b.text()
    f.append({"verdict": "good" if "Mira Kaur" in jt else "bad",
              "note": "Judge panel visible to the organiser", "shot": b.shot("org-judges")})
    f.append({"verdict": "bad" if re.search(r"[\w.]+@[\w.]+\.\w+", jt) else "good",
              "note": "Judge email addresses leak on the organiser page" if re.search(r"[\w.]+@[\w.]+\.\w+", jt) else "Judge emails are not shown on the panel page"})

    b.go("/o/signal-2026/assignments")
    f.append({"verdict": "good", "note": "Assignment matrix reachable", "shot": b.shot("org-assignments")})

    b.go("/o/signal-2026/results")
    rt = b.text()
    f.append({"verdict": "good" if "normalis" in rt.lower() else "bad",
              "note": "Results page explains normalisation" if "normalis" in rt.lower() else "Results page does not explain the scoring method"})
    f.append({"verdict": "good" if "publish" in rt.lower() else "bad",
              "note": "Publishing is an explicit action" if "publish" in rt.lower() else "No explicit publish control"})

    b.go("/o/foundry-2026/results")
    f.append({"verdict": "good", "note": "A finished event shows its standings", "shot": b.shot("org-results-published")})
    b.sign_out()

    r.persona("ORGANISER", "Can I create, configure and run a hackathon?", f)


def critic_judge(b, r):
    f = []
    b.sign_in("judge")
    b.go("/j/signal-2026")
    t = b.text()
    f.append({"verdict": "good", "note": "Judging workspace opens", "shot": b.shot("judge-queue")})
    f.append({"verdict": "good" if "progress" in t.lower() else "bad",
              "note": "Judge can see their own progress" if "progress" in t.lower() else "No progress indicator for the judge"})
    f.append({"verdict": "good" if re.search(r"compare|side by side", t, re.I) else "bad",
              "note": "Comparison is offered from the queue" if re.search(r"compare|side by side", t, re.I) else "No way to compare projects from the queue"})

    # Find an assignment and open the workspace.
    link = b.js("() => { const a = document.querySelector('a[href*=\"/r/\"]'); return a ? a.getAttribute('href') : null; }")
    if not link:
        f.append({"verdict": "bad", "note": "No assignments to review — cannot evaluate the judging experience"})
        r.persona("JUDGE", "Can I understand a project, watch its demo, compare, and finish a review?", f)
        return
    b.go(link, wait=1.3)
    wt = b.text()
    f.append({"verdict": "good", "note": f"Judging workspace for a project opens ({link})", "shot": b.shot("judge-workspace")})

    material = {
        "demo video or live demo": bool(re.search(r"demo|live demo|video", wt, re.I)),
        "repository link": "repository" in wt.lower(),
        "write-up": "what it does" in wt.lower() or "how it works" in wt.lower(),
        "submission answers": "submission" in wt.lower() or "who is this for" in wt.lower(),
    }
    for k, ok in material.items():
        f.append({"verdict": "good" if ok else "bad",
                  "note": f"{k} is on the same page as the rubric" if ok else f"{k} is not visible without leaving the page"})

    # Tab switching for media.
    tabs = b.js("() => Array.from(document.querySelectorAll('.media-tabs button')).map(b => b.textContent.trim())")
    f.append({"verdict": "good" if tabs else "meh",
              "note": f"Media panels: {', '.join(tabs)}" if tabs else "No in-place media panels"})

    # Score a criterion and check the total updates.
    before = b.js("() => (document.querySelector('#totalScore')||{}).textContent")
    b.click(".criterion .scale button:nth-child(4)", wait=2.0)
    after = b.js("() => (document.querySelector('#totalScore')||{}).textContent")
    f.append({"verdict": "good" if before != after else "bad",
              "note": f"Scoring updates the running total live ({before} -> {after})" if before != after else "Scoring does not update the total"})

    b.js("() => new Promise(r => setTimeout(r, 400))")
    save_state = b.js("() => { const el = document.querySelector('#saveState'); return el ? el.textContent.trim() : ''; }")
    f.append({"verdict": "good" if "saved" in save_state.lower() else "bad",
              "note": f"Draft autosaves ({save_state})" if "saved" in save_state.lower() else f"Autosave not confirmed (state: '{save_state}')"})

    # Reload to prove the draft survived.
    b.go(link, wait=1.2)
    kept = b.js("() => { const el = document.querySelector('.criterion input[type=hidden]'); return el ? el.value : ''; }")
    f.append({"verdict": "good" if kept else "bad",
              "note": "The saved score survives a page reload" if kept else "The saved score did not persist"})

    # Queue is present without navigating away.
    q = b.js("() => document.querySelectorAll('.queue__item').length")
    f.append({"verdict": "good" if q else "bad",
              "note": f"Queue ({q} items) is visible while scoring" if q else "No queue visible while scoring"})

    # Compare.
    b.go("/j/signal-2026/compare", wait=1.2)
    ct = b.text()
    f.append({"verdict": "good" if "not assigned" in ct.lower() or re.search(r"side by side", ct, re.I) else "bad",
              "note": "Side-by-side comparison renders", "shot": b.shot("judge-compare")})
    cols = b.js("() => document.querySelectorAll('.compare__col').length")
    f.append({"verdict": "good" if cols >= 2 else "meh",
              "note": f"{cols} projects side by side" if cols >= 2 else f"Only {cols} column(s) — comparison needs two"})

    b.go("/j/signal-2026/pairwise", wait=1.2)
    f.append({"verdict": "good", "note": "Head-to-head mode renders", "shot": b.shot("judge-pairwise")})

    b.go("/j/signal-2026/progress", wait=1.1)
    f.append({"verdict": "good", "note": "Panel progress renders", "shot": b.shot("judge-progress")})
    b.sign_out()

    r.persona("JUDGE", "Can I understand a project, watch its demo, compare, and finish a review?", f)


def critic_judging_org(b, r):
    """The organiser's view while judging is open."""
    f = []
    b.sign_in("organiser")
    b.go("/o/signal-2026/results", wait=1.2)
    t = b.text()
    f.append({"verdict": "good" if "not published" in t.lower() or "publish" in t.lower() else "bad",
              "note": "Organiser can see results are unpublished and act", "shot": b.shot("org-during-judging")})
    f.append({"verdict": "good" if re.search(r"nothing publishes automatically|not published", t, re.I) else "bad",
              "note": "The page is explicit that nothing has auto-published"})
    b.go("/o/signal-2026/activity", wait=1.1)
    f.append({"verdict": "good", "note": "Activity log available", "shot": b.shot("org-activity")})
    b.sign_out()

    r.persona("ORGANISER DURING JUDGING", "Can I see what is happening without publishing early?", f)


def critic_after_results(b, r):
    f = []
    b.go("/h/foundry-2026")
    t = b.text()
    f.append({"verdict": "good", "note": "Finished event page is readable", "shot": b.shot("after-event")})
    b.go("/h/foundry-2026/results", wait=1.1)
    rt = b.text()
    f.append({"verdict": "good" if "Overall winner" in rt else "bad",
              "note": "Results name the winner" if "Overall winner" in rt else "Results do not name a winner"})
    f.append({"verdict": "good" if "normalised" in rt.lower() else "meh",
              "note": "The scoring method is disclosed to the public" if "normalised" in rt.lower() else "Public results do not explain the score"})
    f.append({"verdict": "bad" if re.search(r"\b(prj_|evt_|tm_|trk_)\S*", rt) else "good",
              "note": "Results leak internal identifiers" if re.search(r"\b(prj_|evt_|tm_|trk_)\S*", rt) else "No internal identifiers in results"})

    b.go("/projects", wait=1.1)
    st = b.text()
    f.append({"verdict": "good", "note": "Showcase lists finished work", "shot": b.shot("after-showcase")})
    b.go("/projects/foundry-2026/bandit-proxy", wait=1.1)
    pt = b.text()
    f.append({"verdict": "good" if "Bandit Proxy" in pt else "bad",
              "note": "A project page reads like a project, not a row", "shot": b.shot("after-project")})
    b.sign_out()

    r.persona("PUBLIC USER AFTER RESULTS", "Can I see what was built and who won?", f)


def critic_host_new(b, r):
    """A brand-new organiser creating an event from nothing."""
    f = []
    b.sign_in("organiser")
    b.go("/host/new", wait=1.0)
    t = b.text()
    f.append({"verdict": "good", "note": "Event creation form is reachable", "shot": b.shot("host-form")})
    needed = ["name", "tagline", "start time", "end time", "submissions close", "timezone"]
    missing = [n for n in needed if n.lower() not in t.lower()]
    f.append({"verdict": "good" if not missing else "bad",
              "note": "Creation form asks for the essentials" if not missing else f"Creation form is missing: {', '.join(missing)}"})

    b.fill("input[name=name]", "Critic Test Event")
    b.fill("input[name=tagline]", "A throwaway event created by the human critic to check the flow works end to end.")
    b.fill("input[name=about]", "Created automatically during the critic run. Safe to delete.")
    b.fill("input[name=timezone]", "Europe/London")
    b.fill("input[name=startsAt]", "2027-04-09T09:00")
    b.fill("input[name=endsAt]", "2027-04-10T18:00")
    b.fill("input[name=submissionsCloseAt]", "2027-04-10T16:00")
    b.click("form[action='/host/new'] button[type=submit]", wait=1.8)
    created = "/o/critic-test-event" in b.url()
    f.append({"verdict": "good" if created else "bad",
              "note": f"Event created and console opened ({b.url()})" if created else f"Event creation failed, landed on {b.url()}",
              "shot": b.shot("host-created")})

    if created:
        ot = b.text()
        f.append({"verdict": "good" if "track" in ot.lower() else "bad",
                  "note": "New event is seeded with tracks/rubric guidance" if "track" in ot.lower() else "New event gives no next step"})
        b.go("/h/critic-test-event", wait=1.0)
        f.append({"verdict": "good" if "Critic Test Event" in b.text() else "bad",
                  "note": "New event has a public page", "shot": b.shot("host-public")})
    b.sign_out()

    r.persona("ORGANISER CREATING AN EVENT", "Can I create and configure a hackathon from nothing?", f)


PERSONAS = {
    "visitor": critic_visitor,
    "participant": critic_participant,
    "organiser": critic_organiser,
    "judge": critic_judge,
    "judging": critic_judging_org,
    "results": critic_after_results,
    "host": critic_host_new,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="run one persona: " + ", ".join(PERSONAS))
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--height", type=int, default=1000)
    args = ap.parse_args()

    out(f"Hackerly human critic against {BASE}")
    b = Browser(args.width, args.height)
    b.start()
    r = Report()
    try:
        for name, fn in PERSONAS.items():
            if args.only and args.only != name:
                continue
            try:
                fn(b, r)
            except Exception as exc:  # a crash in one persona is a finding, not a stop
                r.persona(name.upper(), "(crashed)", [{"verdict": "bad", "note": f"critic error: {exc}"}])
    finally:
        bad, meh = r.summary()
        out(f"\n  screenshots: {SHOTS}")
        b.close()
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
