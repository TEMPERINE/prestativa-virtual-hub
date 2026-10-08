# Office notice UX
## Sprite rendering phase 1
- [ ] Separate exact atlas frame selection from fine alignment; remove texture filters and preserve independent ground shadow.
- [ ] Evaluate device pixel grid without quantizing logical movement or changing assets.
- [ ] Compare five existing sprites idle/walking, actual Office size and enlarged edge crops; run tests and verify automatic type safety. Stop without publishing.

- [x] Central bell celebration popup with sender sprite and positive copy, separate from notices.
- [x] Only display/count time in foreground; show pending normally on return.
- [x] Verify popup visuals in isolated browser, closing, focus lifecycle and 575 tests; do not publish.
- [x] Prioritize actions over celebrations and information; cap ordinary stack at three and queue information (all simultaneous actions remain visible even above approximate cap).
- [x] Make area feedback compact, short-lived and replaceable (1.8 seconds).
- [x] Validate refined stack in browser, tests and automatic type safety without publishing.
- [x] Apply positive pending-celebration copy.
- [x] Share visual alignment and stacking across Office notices, accounting for Equipe.
- [x] Validate positioning, actions and relevant tests without publishing (isolated browser checks and full automated suite; no live invitations sent).