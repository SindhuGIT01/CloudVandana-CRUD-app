# Salesforce Ops Agent — Test Conversations

Four scripted conversations that exercise the agent end to end: a simple
read, a filtered bulk update, a destructive action that must be confirmed,
and an ambiguous request. Use them as a manual smoke test after changes,
and as worked examples when explaining the design.

## How to run these

1. Start the app (`npm run dev` in `server/` and `client/`, or the
   deployed build) and make sure `ANTHROPIC_API_KEY` is set in the server
   environment.
2. Log in through Salesforce, then open **`/agent`** ("Try the Salesforce
   Ops Agent (beta)" from the dashboard).
3. Type the **User** lines below one at a time and check the agent's
   behaviour against **Expected**.

The agent is an LLM, so exact wording varies between runs. What should be
stable is the *shape*: which tools it calls, the arguments it builds, when
it pauses for confirmation, and whether the final answer is readable prose
rather than JSON.

The tool calls listed below are what the server executes
(`server/src/agent/executeTool.ts`); you can see them in the server
console if you add logging, or infer them from the result.

---

## 1. Simple read

**Goal:** a single `search_records` call, results summarised in plain text.

| | |
|---|---|
| **User** | `Show me the 5 newest opportunities` |
| **Tool call** | `search_records({ object: "Opportunity", fields: ["Id", "Name", "Amount", "StageName", "CreatedDate"], order_by: { field: "CreatedDate", direction: "DESC" }, limit: 5 })` |
| **Expected reply** | One line of summary then a short bullet list, e.g.<br>"Here are the 5 most recently created opportunities:<br>- **Acme - 200 Widgets** — $120k, Stage: Negotiation, created Sep 3<br>- …" |

**Verifies:** read path works; `order_by` + `limit` are used for
"newest"; the reply is prose + a bullet list, no raw JSON, no SOQL, no
record Ids (per the Task 6 formatting contract).

**Variations to try:**

- `How many open cases are there?` → `search_records` on `Case` with a
  filter like `Status != 'Closed'`; the agent reports the count from
  `totalSize`, not a dump of rows.
- `Show opportunities over $50,000 in the Negotiation stage` → two
  filters (`Amount > 50000`, `StageName = 'Negotiation'`) combined with
  AND.

---

## 2. Filtered bulk update (search → decide → act)

**Goal:** the agent searches, narrows to the matching Ids, and makes **one**
`update_records` call rather than many single updates.

| | |
|---|---|
| **User** | `Set every lead from the "Web" source with no rating to "Cold"` |
| **Tool call 1** | `search_records({ object: "Lead", fields: ["Id", "Name", "LeadSource", "Rating"], filters: [ { field: "LeadSource", operator: "=", value: "Web" }, { field: "Rating", operator: "=", value: null } ] })` |
| **Tool call 2** | `update_records({ object: "Lead", ids: ["00Q…", "00Q…", …], fields: { Rating: "Cold" } })` — **paused for confirmation first** (see scenario 3 for the mechanics) |
| **Expected reply (after "yes")** | "Updated **7 of 7** leads to Rating = Cold." (and it names any that failed) |

**Verifies:** the search → decide → act loop; Ids come from the search
result, never invented; a set of records is changed with a single bulk
call; the final answer states a count.

**Variation — the classic one:**

- `Close all opportunities older than 90 days that have had no activity`
  → `search_records` on `Opportunity` with
  `CreatedDate < LAST_N_DAYS:90` (`value_is_literal: true`) plus activity
  fields (`LastActivityDate`), the agent filters the returned rows down
  to those with no activity, then one `update_records` setting
  `StageName` to a closed stage. If "close" is genuinely unclear for the
  org it should ask which stage — see scenario 4.

---

## 3. Destructive action requiring confirmation

**Goal:** nothing is written to Salesforce until the user says yes; the
preview is built from the tool arguments, not from what the model claims.

| | |
|---|---|
| **User** | `Delete the contact named "Test Person"` |
| **Tool call 1** | `search_records({ object: "Contact", fields: ["Id", "Name"], filters: [ { field: "Name", operator: "=", value: "Test Person" } ] })` → 1 match |
| **Agent reply** | Ends the turn **without deleting**. Returns `awaitingConfirmation: true` and a message like:<br>"I found one contact named Test Person.<br><br>**This will change your Salesforce data:**<br>- Delete 1 Contact (003…).<br><br>Reply \"yes\" to proceed or \"no\" to cancel." |
| **UI** | A confirmation bar appears with **Yes, proceed** / **No, cancel** buttons. |
| **User** | `no` (or the button) |
| **Agent reply** | "Okay — I didn't delete anything." Nothing hit Salesforce. |
| **Re-run and reply** | `yes` → `delete_record({ object: "Contact", id: "003…" })` runs, then "Deleted the contact Test Person." |

**Verifies:** every `update_record` / `delete_record` / `update_records` /
`delete_records` call is gated; the transcript is stashed on the session
and resumed on the next message; "no" feeds a *declined* result back so
the agent acknowledges instead of erroring out; the preview lists the
exact object, count, and Ids.

**Also check:**

- After a `yes`, sending an unrelated message starts fresh (no stale
  pending action).
- Replying with something that isn't yes/no (e.g. `maybe`) re-shows the
  preview and keeps waiting.
- A pending action older than 15 minutes is dropped and the new message
  is treated as a fresh request.

---

## 4. Ambiguous request

**Goal:** the agent asks **one** short clarifying question instead of
guessing an object, a record, or a value.

| | |
|---|---|
| **User** | `Update the Acme record` |
| **Tool calls** | none |
| **Expected reply** | "Which record do you mean — the **Account** called Acme, or a related opportunity/contact? And what would you like to change?" |

**Verifies:** no tool call is made; the agent doesn't pick an object or a
field value on the user's behalf.

**More ambiguity cases:**

| User says | Why it's ambiguous | Expected |
|---|---|---|
| `Bump the amount on the Globex deal` | New value not given | "What amount should I set it to?" |
| `Mark the Playtime opportunity as done` | "done" could be Closed Won or Closed Lost | "Do you mean Closed Won or Closed Lost?" |
| `Delete the Smith contact` (3 contacts named Smith) | Name matches several records | Lists the 3 matches and asks which one(s) |
| `Archive the old leads` | "old" undefined, "archive" isn't a field | Asks for a cut-off date and what "archive" should set |

---

## Error handling spot-checks (Task 7)

Not part of the four core conversations, but quick to verify:

- **No matches:** `Find accounts named "Nonexistent Corp 12345"` → agent
  says nothing matched and stops; it does **not** loosen the filter on
  its own.
- **Bad field name:** `Show me the Opportunity FizzBuzz__c field` →
  Salesforce returns an `INVALID_FIELD` error; the agent explains it in
  plain language and stops rather than retrying the same call.
- **Expired Salesforce session:** if the OAuth token dies mid-request the
  agent aborts with "Your Salesforce session expired… reload the page and
  log in again," shown as an error bubble.
- **Missing API key:** with `ANTHROPIC_API_KEY` unset the agent replies
  that it isn't configured; the rest of the CRUD app is unaffected.
