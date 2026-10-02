# Kinetic Duo: Adaptive Fitness Prototype

## Run it (30 seconds)
The prototype is a single file with no build step: `index.html`.

    python3 -m http.server 8000      # or: npx serve .
    # open http://localhost:8000 in Chrome, Edge or Safari

Serve it from localhost (or https) as a normal top-level page. That is what
lets the in-chat microphone work. Double-clicking the file also works, but
browsers may block the mic from file:// pages.

## What is inside
- `index.html`: the full working prototype
  - Sync tab: calendar that previews and confirms coach adaptations, duo slots, solo timer
  - Coach tab: adaptive negotiator chat, typed or spoken (mic button in the chat box), spoken replies toggle
  - Session tab: dial timer for duo or solo sets
  - Room tab: streak, 800 kcal collective goal, consistency rewards (5+ active days a week)
- `original-upload/`: the project files you uploaded, unchanged

## Guardrails built in
Declines or escalates: health, injury, medication and mental-health topics (hands off to a human),
math problems, travel or ticket booking, and any personal or payment information
(the message is withheld from the chat).

## Known limits
- Replies come from a rules engine in the browser. No Gemini call is made.
- Heart-rate, Alex's RSVP, kcal and the rewards points are simulated demo values.
- "Connect me with a human" is a simulated hand-off; wire it to your real support channel.
- Safety checks are keyword-based. Add a model-based check before real users.

## About original-upload
`server.ts` imports `./src/utils/negotiatorEngine` and `index.html` loads `/src/main.tsx`,
but no `src/` folder was included in the upload, so that project cannot run as is.
Also, the config file is named `vite_config.ts` (Vite expects `vite.config.ts`),
the model name `gemini-3.8-flash` looks like a typo, and there is a `bun.lock` while the
README says npm.
