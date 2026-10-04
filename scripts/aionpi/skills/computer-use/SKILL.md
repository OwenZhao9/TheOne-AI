---
name: computer-use
description: Operate macOS applications through TheOne's Computer Use tool, with Jev-assisted decisions and no extra action-confirmation dialog.
---

# Computer Use

Use the `computer` tool for real screen inspection and desktop interaction. Do not pretend an action happened from webpage text alone.

## Fast desktop subtasks

After discovering/opening the correct app and exact window once with `computer`, prefer `computer_task` for routine multi-step desktop navigation and input. It uses Jev to select native controls and the SAME Cua Driver to execute, without a planner round trip for every action. Do not repeatedly discover known tool schemas.

If the requested item is already visible, click it directly. Never detour through search merely because the native control list omits it. For example, when File Transfer Assistant is visible in WeChat's conversation list, use the original fresh desktop screenshot/click route to open that row, verify the chat heading, then use `computer_task` for supported controls. Do not hard-code its position or treat another chat's composer as a search field.

- Supply the observed `pid`, `window_id`, one unique `session`, and a precise authorized `goal` with a visible completion condition. Preserve exact recipient names and text; do not translate them.
- Supply at most eight text/key `resources`, each with a stable ID and purpose. A text resource inserts into an empty field only. A key is one of `return`, `tab`, `escape`, `up`, `down`, `left`, `right`. User-specified literal text requires no extra text-generation request. No passwords, secrets, codes, or payment information.
- Keep resource IDs and session stable across a handoff; attempted resources are not automatically retried. A Return or explicitly terminal action ends the fast subtask so you can verify before further effects.
- If entering a final draft is the whole subtask, mark that text resource `terminal: true`. This returns fresh evidence immediately after input instead of spending another Jev decision just to decide whether to stop. Do not mark intermediate resources terminal when more actions are required in the same subtask.
- The tool returns `needs_verification`, NOT proof of success. Inspect the final screenshot/state to verify the requested result and recipient. Never resend because the tool returned uncertain or timed out.
- `handoff` means resume the SAME task through the original `computer` tool from the returned state. Do not start over. Use fresh screenshots for custom controls, mini-program canvases, missing native controls or ineffective clicks. The fast loop cannot invent coordinates or bypass an active Jev rejection.
- This is general-purpose, not a WeChat macro. Split tasks at meaningful checkpoints such as selecting a recipient, completing a form, or submitting once. Do not split every ordinary click into a separate planner call.
- Do not add confirmation dialogs for an already explicitly authorized action. Missing choices/authority still need to be resolved with the user; Jev never supplies permission.

## Original desktop actions and visual handoff

1. If an action or its arguments are not known exactly, call `computer` with `action: "list_tools"`, then `action: "describe_tool"` and `arguments: {"tool":"the_exact_name"}`. Do not guess a schema.
2. For opening or switching to an application, prefer `list_apps` followed by `bring_to_front` for a running app. If the app has multiple eligible windows, call `list_windows` with its pid, choose the visible current-space window with the highest numeric `z_index`, and pass its `window_id` to `bring_to_front`. If the app is not running, use `launch_app`, inspect again, and then use `bring_to_front`. Do not click a Dock icon when a direct application action is available.
3. Inspect before other interactions. Start with `get_desktop_state` for the full display or `get_window_state` for one application. Choose a fresh public `session` label for each new task and repeat it for that whole task; never reuse a label from a completed task. TheOne keeps the private Cua connection alive so capture IDs and element tokens remain valid across related calls.
4. Keep actions small: observe, perform one interaction, then observe again. On every modifying computer call, include a top-level `observation` string describing the observed application, target label or chat title, and intended effect. Do not put it inside the driver's `arguments`. Jev is text-only: screenshot bytes and unexplained coordinates are not evidence it can interpret. Describe only what the latest observation actually shows; never invent a label or permission. Confirm the visible result after every navigation or form submission. If window-targeted input has no visible effect, inspect the full desktop before trying a different route. Use desktop-targeted coordinates only from a fresh desktop capture where the intended control is visible. Do not combine `target` with legacy `scope`, `pid`, or `window_id` fields.
5. Never paste passwords, API keys, payment-card data, or one-time codes into Jev. Ask the user to enter private credentials themselves when needed.
6. For choices with consequences—such as selecting a flight—collect the candidates and explicit user constraints first. Call `jev_judge` with all decision-relevant facts, including a clear `unclear` option, before selecting a candidate.
7. Jev is a judge, not permission. It may rank or reject candidates, but it cannot authorize a purchase, booking, message, deletion, or final submission.
8. The `computer` tool does not show an extra action-confirmation dialog. Do not request repeated approval for actions the user already explicitly authorized. If the user has not authorized a consequential action or a required choice is missing, ask in the conversation rather than inventing permission. In Jev active mode, a rejected or uncertain action returns an error; do not bypass that rejection.
9. If Cua Driver, macOS permissions, or Jev is unavailable, state the exact missing capability. Do not fabricate a screenshot, judgment, click, or result.

For a flight task: search → collect price/time/baggage/refund facts → call `jev_judge` → open the selected itinerary → verify the review page → proceed only within the user's explicit booking or payment authorization.
