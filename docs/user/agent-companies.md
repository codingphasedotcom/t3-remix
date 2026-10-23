# Agent companies

An agent company is a team of AI agents with a CEO, employees in an org chart, a skill
library, and its own kanban board. You give the CEO tasks; the CEO plans each one, hands
the work to its employees, reviews what they deliver, and hands the finished task back to
you. Agents coordinate only through the board, never by messaging each other.

Open **Companies** from the sidebar footer on web and desktop, or switch the sidebar to
**Companies** to see each company's employees with the threads they worked in; **Board** beside
a company opens its board, and the button next to it opens its dashboard. The mobile app does not
show companies yet.

## Start a company

Click **New company** and give it a name, a mission, a CEO name, and a model. Pick where the
team works: a new project folder, or one of your existing projects. **Software team** adds a
CTO, two engineers, and QA with starter skills; **Just a CEO** lets you build the team
yourself. Each company has its own board, org chart, and skills; switch companies from the
menu at the top left.

## Build the org chart

**Org chart** draws the company top-down, from the CEO through each manager to their reports,
with a face for every employee (pick another in their editor). Use **Add employee** or the
add-report button on any person to hire under them. Each employee has a role, a department, a
manager, skills, a model, permissions, and standing instructions. Pause an employee to keep
their tasks without starting them.

## Departments

Every employee belongs to one department. A new company starts with Executive, Design,
Marketing, Engineering, and Customer Support; rename, add, or remove them under **Edit company**
in the company menu. A department can be removed only once nobody is in it. Agents see who is in
each department, so the CEO can route work to the right team and ask you to hire into a
department that is still empty.

A manager can assign work only to people beneath them; the CEO can assign anyone. When an
agent needs a role nobody has, it asks you: the request appears at the top of the org chart,
and the agent exists only after you choose **Hire**.

Board agents run unattended. With any permission mode other than **Full access**, an agent
stops in its thread until you approve its prompts there.

## Memory

Agents start every task fresh, so each employee keeps a memory: short lessons such as the
project's test command or a preference you stated. Before finishing a task, an agent records
anything worth keeping; the CEO and managers also keep a company memory that every agent sees.
Both are included in each agent's prompt, are capped in size, and are condensed by the agents
when they fill up. Read or edit an employee's memory in their editor on **Org chart**, and the
company memory under **Edit company** in the company menu. Agents can also
search earlier tasks to see how similar work was done.

## Skills

A skill is a reusable playbook: when it applies, how to do the work, and how to check it. Add
skills on the **Skills** tab (or **Add starter skills**), then tick them on each employee.
Agents receive the instructions of every skill they have on each task they work; when an
employee's skills add up to more than a page, the prompt lists them by name and the agent reads
the ones that apply.

## How work flows

- A task in **To do** with an assignee starts that agent in a new thread. New tasks go to the
  CEO unless you pick someone else.
- A manager splits its task into subtasks for its reports and moves its own task to
  **Blocked**. Subtasks work in the parent task's worktree, so the parent's branch collects
  the whole result. When every subtask is done, the parent returns to **To do** and the
  manager continues.
- Work a manager delegates comes back to that manager for review: **Done** approves it;
  **To do** sends it back with requested changes, and the employee continues in its own
  thread.
- A task with no reviewer stops in **Review** for you. **Backlog** tasks never start on their
  own.
- When a subtask gets stuck in **Blocked**, its manager is started to unblock it: it answers the
  question, reassigns the subtask, or narrows it, and asks you on its own task when only you can
  help. A subtask that is only waiting on its own subtasks doesn't count as stuck.

Every agent is told where it works: the folder, the branch, the base it started from, which
other tasks share that folder, and that work from other tasks is only there once it is merged.
Branches are not merged for you, so a task that needs another task's work waits until you
merge it.

Type `@` and a job, such as `@CTO` or `@QA`, to mention an employee. In a new task's title or
description, the first person you mention becomes the assignee unless you already picked one. In
a chat in the company's project, the agent sees exactly who you mean and can hand them a task.

Comment on a task and its owner answers on the board right away. An agent already working on
the task gets your comment in its thread; otherwise the assignee (or the CEO, for a task with
no assignee) is started just to reply, and moves the task to **To do** if you asked for work.
Replies start even when the board is at its **Agents at once** limit, but not while
**Auto-run agents** is off or the employee is paused. Your comments on a task also reach every
subtask below it and stay in the agents' instructions on every later run. Each employee keeps
one thread per task: replies, work, rework, and repeat reviews all continue it, so agents keep
their context and each new message carries only what changed. Open a task to see
its activity, its runs, and links to each agent's thread.

Attach files a task needs, such as a video to edit from your Downloads folder, under **Files**
when you create the task or later in the task. In the desktop app, use **Add files** or drop them
in; in a browser, paste the file's full path. Nothing is uploaded: agents work from the files
where they are on the computer running T3 Code, and subtasks see their parent's files too.

A task lists its **Linked work**: its branch, and the pull requests, previews, and documents its
agents report, with each pull request's status. Remove a wrong link with its **×**.

## Routines

The **Routines** tab adds a task on a schedule, such as a weekly review for the CEO: pick the
title, what to do, who does it, how often it repeats, and when it next runs. If the last task a
routine added is still open when it comes due, it waits for the next turn instead of adding
another. A routine with nobody assigned adds its task to **Backlog**.

## Spending limits

Set a monthly token limit for the whole company under **Edit company**, or for one employee in
their editor. Limits count input plus output tokens per calendar month (UTC), the same total the
dashboard shows. From 80% the org chart and board warn you; at the limit, agents aren't started
until you raise it or the month ends. An agent already running finishes its run.

## Dashboard

**Dashboard** shows how the company is doing: open and finished tasks, who is working now, how
often runs succeed, how long tasks take from creation to done, and the tokens spent. Below that
are daily activity for the last 14 days, a **Needs attention** list (blocked or unassigned tasks,
hire requests, failed runs), a breakdown by model and by department, and a row for every
employee.

Tokens are counted from each employee's board threads and credited to the model that thread ran.
A running agent's tokens appear when its run ends. Days start at midnight in your time zone.

## Board settings

The board's settings menu controls:

- **Auto-run agents**: turn off to start tasks only with **Start agent** on a task.
- **Worktree per task**: each top-level task gets its own worktree on a `board/<task>` branch
  from the project's current `HEAD`. Turn off to let agents share the project checkout.
- **Agents at once**: how many tasks can run at the same time. Ready tasks wait for a slot.
