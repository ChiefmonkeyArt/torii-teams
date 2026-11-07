# ADR 0010: Joining that works

Date: 2026-11-06. Status: **Accepted** (owner, 2026-11-06, after the first
real-team test of torii.9: "Personal invites should be straight in one
click… the group link … should default the user to a waiting queue and the
other option is also straight in 1-click"). Target: `0.6.1-torii.10` with
Continuum `v0.2.199-alpha` and Suite `v0.9.40-alpha` (implemented there;
see "Amendments on acceptance"). Amends ADR 0009
(invite links) and ADR 0002 (Teams in Continuum); keeps ADR 0008 (one
sign-in) as is.

## Context

The owner tested torii.9 invite links with the team. Nobody could get in
without help, and it was "not at all intuitive". The causes, from the code:

1. **A group link let in one person.** An open link defaulted to one use, so
   the first person to claim it used it up and the rest saw "This invite no
   longer works".
2. **Let in, still no access.** After "Let in" the person is a member, but
   only the owner's own Teams client can add them to the encrypted chat
   (MLS). Teams ran only inside Continuum's Team page, so once the owner left
   that page newcomers sat on "Waiting to be added" with no end in sight.
3. **Nobody could see the invite.** A waiting request showed only as
   "(n waiting)" inside the Team page's project picker. The owner got no
   alert anywhere else; the newcomer got no clear next step.
4. **"Create a project first"** appeared on the Team page for an owner with
   two long-standing projects. The Team page read the project list once at
   render, before Continuum had finished loading it, and never redrew.
5. **Emoji reactions seemed missing.** They exist (Cordn), but only as a
   small hover button beside a message (long-press on touch).
6. **An app inside the app.** The embedded chat kept its own account footer
   (avatar, name, Sign out), while Continuum's own menu showed a hard-coded
   "C" instead of the owner's avatar.
7. **"Roster"** is the wrong word for people on a project.

## Decision

### 1. Three ways in

| Link                                 | Who it is for                      | What happens                                             |
| ------------------------------------ | ---------------------------------- | -------------------------------------------------------- |
| Personal link                        | One person, picked by name or npub | Straight in, one click                                   |
| Group link, "Ask me first" (default) | Anyone holding it                  | Joins the waiting queue; the owner lets them in          |
| Group link, "Let them straight in"   | Anyone holding it                  | Straight in, one click, until its places or time run out |

- **Personal link in one step.** "Add person" then "Invite": Continuum adds
  the person, signs the member list (one signature) and copies their
  personal link. No separate "Sign and save" before a link can be made.
- **Group links fill the team.** Default places = the seats left on the
  project (at most 11, the 12-person cap minus the owner). The owner can set
  fewer.
- **Straight-in group links keep the owner's key as the only authority.**
  When making one, the owner signs a short **invite grant** (kind `27098`,
  never published): tags `project`, `invite` (link id), `role`, `uses` and
  `expiration`, empty content. The node checks the signature is the owner's,
  the time is within 10 minutes, and every tag matches the link it creates.
  Each claim then admits one person under that grant, until `uses` or
  `expiration` runs out or the owner presses Stop. A forwarded straight-in
  link lets the holder in; the UI says so next to the choice.
- **Admitted members.** A person let in by a grant is stored beside the
  signed member list as `admitted: [{pubkey, role, at, invite}]` in the same
  project file. Everything that reads membership (sign-in, chat sync,
  repository read) reads signed members plus admitted ones. The owner's
  next signed member list absorbs them: Continuum always starts from the
  latest list (re-read just before signing), so admitted people stay unless
  the owner removed them. On every member-list save the node drops admitted
  entries that the new list includes, or that are older than it.

### 2. Teams keeps running while Continuum is open

Continuum loads one Teams frame per page load, not one per visit to the
Team page. It sits in the Team page's chat slot while that page is shown
and stays hidden but running everywhere else in Continuum. The owner's
client therefore adds newcomers whenever the owner has Continuum open, and
each page change no longer reloads the chat. Continuum tells the frame which
project to show with `torii:navigate` (exact origins both ways, path limited
to `/chat` and `/chat/p/<slug>`).

The owner's signer may still be asked once when a newcomer is added to the
encrypted chat (Cordn's welcome); that prompt can now appear on any
Continuum page, and Teams names what it is for.

### 3. Waiting is visible to both sides

- **Owner:** Continuum's account menu, bottom left, shows "N waiting to
  join" on every page (owner only, checked every 60 s while visible). It
  opens the Team page on the first project with someone waiting, where
  "Let in" and "Decline" sit at the top of the Members card.
- **Newcomer:** the waiting screen says who was asked, that the page
  updates itself and that it is fine to close it. Once let in, a member
  whose chat is not ready yet reads "You're in. {owner} adds you to the chat
  the next time their Continuum is open." instead of "Waiting to be added".

### 4. Continuum owns identity when Teams is embedded

Embedded in Continuum, Teams hides its account footer (avatar, name, Sign
out). Continuum's account menu shows the signed-in person's Nostr avatar and
name (proxied through the node, as the member list already does) instead of
the letter C.

### 5. Smaller fixes

- The Team page redraws its member card when Continuum's project list
  changes, so "Create a project first" shows only with no projects.
- Reactions: double-clicking a message opens the reaction picker. The
  reaction button in the bar beside each bubble (hover or keyboard focus)
  and long-press on touch stay as Cordn has them.
- Words: "Roster" becomes **Members** in every on-screen text. Code, events
  (kind 30098) and routes keep the word roster.

### 6. A welcome on the invite

The invite screens show the shisa pair (AI on the left with a closed-mouth
smile, the human on the right laughing and waving). A personal link and the
waiting screen get a short CSS pop-in, bob and twinkle; an ask-first group
link shows it still. The picture is bundled with the app (a 40 KB WebP, no
outside request) and the motion stops for `prefers-reduced-motion`. The
"You're in" screen shows it too, just after a straight-in join.

## Amendments on acceptance

- Owner, 2026-11-06: "can the personal invite include some graphic or
  animation?" Added as section 6.
- Section 5, reactions: Cordn already shows a reaction button beside the
  bubble on hover and focus, so the change is the double-click only.
- Found in local testing: the waiting page asked only once a minute, so
  after Let in it could sit for up to 60 s. It now asks every 20 s while
  waiting (network only; 3 a minute, far under Continuum's 20-a-minute
  limit). The account menu's waiting count also refreshes when the tab
  comes back into view.
- Owner, 2026-11-07 (after the team test), reactions: "1 tap thumbs up
  long hold emoji row". Replaces the double-click in section 5. Each
  message from someone else shows a small thumbs up beside its time: one
  tap or click adds a thumbs up, a second removes it. Press and hold (or
  right-click) opens the full emoji row; on a phone that is Cordn's action
  sheet. Your own messages don't show it. Shipped in `0.6.1-torii.11`.
  Zaps ("1 tap zap") come later under their own ADR.

## Consequences

- One owner signature per straight-in group link replaces one per person.
  The grant is bounded by places and time and can be stopped; it never
  outlives the link.
- Admitted members are node state signed only through the grant, until the
  owner's next member-list save folds them in. Removing one is the same
  member-list save as removing anyone.
- A hidden Teams frame keeps relay connections open while Continuum is open.
  It loads only for a signed-in owner with Teams installed.
- Still open: adding people when the owner has no Continuum open at all
  (would need a node-held group key; separate ADR), QR codes for links and
  an invite step in new-project setup.
