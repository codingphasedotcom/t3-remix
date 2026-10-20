# Agent board

The agent board is a kanban board per project that a team of named agents works
from. You write cards; agents pick them up, comment, split work into subtasks, and
hand finished cards to a reviewer. Agents coordinate through the board, not by
messaging each other.

Open it from the **Board** button in the sidebar footer on web and desktop. The
mobile app does not show the board yet.

## Build a team

Click **Team** and add agents from a preset (tech lead, software engineer, code
reviewer, QA engineer) or create your own. Each agent has a name, a role, standing
instructions, a model, and a permission mode. Agents are shared by every board in
the environment. Only people can add or remove agents.

Board agents run unattended. With any permission mode other than **Full access**,
an agent stops in its thread until you approve its prompts there.

## Run cards

- A card in **To do** with an assignee starts that agent in a new thread.
- When the agent finishes, it comments and moves its card to **Review**. If it ends
  its turn without moving the card, the board moves it to Review for it, or to
  **Blocked** when the run failed.
- A card in **Review** with a reviewer starts the reviewer in the same worktree. The
  reviewer approves by moving the card to **Done**, or moves it back to **To do**
  with the changes it wants; the original agent then continues in its own thread.
- **Backlog** cards never start on their own.

A lead agent can split its card into subtasks and move its own card to **Blocked**.
When every subtask is done, the parent returns to **To do** and the lead resumes.

Comments you add while an agent is working reach that agent right away. Open a card
to see its activity, its runs, and links to each agent's thread.

## Board settings

The board's settings menu controls:

- **Auto-run agents**: turn off to start cards only with **Start agent** on a card.
- **Worktree per card**: each card gets its own branch and worktree, created from
  the project's current `HEAD`. Turn off to let agents share the project checkout.
- **Agents at once**: how many cards can run at the same time. Ready cards wait for
  a free slot.
