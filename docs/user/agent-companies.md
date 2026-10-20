# Agent companies

An agent company is a team of AI agents with a CEO, employees in an org chart, a skill
library, and its own kanban board. You give the CEO cards; the CEO plans each one, hands
the work to its employees, reviews what they deliver, and hands the finished card back to
you. Agents coordinate only through the board, never by messaging each other.

Open **Companies** from the sidebar footer on web and desktop, or switch the sidebar to
**Companies** to see each company's employees with the threads they worked in. The mobile app
does not show companies yet.

## Start a company

Click **New company** and give it a name, a mission, a CEO name, and a model. Pick where the
team works: a new project folder, or one of your existing projects. **Software team** adds a
CTO, two engineers, and QA with starter skills; **Just a CEO** lets you build the team
yourself. Each company has its own board, org chart, and skills; switch companies from the
menu at the top left.

## Build the org chart

**Org chart** draws the company top-down, from the CEO through each manager to their reports,
with a face for every employee (pick another in their editor). Use **Add employee** or the
add-report button on any person to hire under them. Each employee has a role, a manager, skills, a model, permissions, and standing
instructions. Pause an employee to keep their cards without starting them.

A manager can assign work only to people beneath them; the CEO can assign anyone. When an
agent needs a role nobody has, it asks you: the request appears at the top of the org chart,
and the agent exists only after you choose **Hire**.

Board agents run unattended. With any permission mode other than **Full access**, an agent
stops in its thread until you approve its prompts there.

## Memory

Agents start every card fresh, so each employee keeps a memory: short lessons such as the
project's test command or a preference you stated. Before finishing a card, an agent records
anything worth keeping; the CEO and managers also keep a company memory that every agent sees.
Both are included in each agent's prompt, are capped in size, and are condensed by the agents
when they fill up. Read or edit an employee's memory in their editor on **Org chart**, and the
company memory under **Edit name, mission, and memory** in the company menu. Agents can also
search earlier cards to see how similar work was done.

## Skills

A skill is a reusable playbook: when it applies, how to do the work, and how to check it. Add
skills on the **Skills** tab (or **Add starter skills**), then tick them on each employee.
Agents receive the instructions of every skill they have on each card they work.

## How work flows

- A card in **To do** with an assignee starts that agent in a new thread. New cards go to the
  CEO unless you pick someone else.
- A manager splits its card into subtasks for its reports and moves its own card to
  **Blocked**. Subtasks work in the parent card's worktree, so the parent's branch collects
  the whole result. When every subtask is done, the parent returns to **To do** and the
  manager continues.
- Work a manager delegates comes back to that manager for review: **Done** approves it;
  **To do** sends it back with requested changes, and the employee continues in its own
  thread.
- A card with no reviewer stops in **Review** for you. **Backlog** cards never start on their
  own.

Comments you add while an agent is working reach that agent right away. Open a card to see
its activity, its runs, and links to each agent's thread.

## Board settings

The board's settings menu controls:

- **Auto-run agents**: turn off to start cards only with **Start agent** on a card.
- **Worktree per card**: each top-level card gets its own branch and worktree from the
  project's current `HEAD`. Turn off to let agents share the project checkout.
- **Agents at once**: how many cards can run at the same time. Ready cards wait for a slot.
