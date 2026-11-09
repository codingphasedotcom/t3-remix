# Agent companies

An agent company is a team of AI agents with a CEO, employees in an org chart, a skill
library, and its own kanban board. You give the CEO tasks; the CEO plans each one, hands
the work to its employees, reviews what they deliver, and hands the finished task back to
you. Agents coordinate only through the board, never by messaging each other.

Open **Companies** from the sidebar footer on web and desktop, or switch the sidebar to
**Companies** to see each company's employees with the threads they worked in; **Board** beside
a company opens its board, and the button next to it opens its dashboard. The mobile app does not
show companies yet.

An employee's list shows only threads that are still open. Threads settle on their own after a few
days without activity, or when you settle one from its row; settled and archived threads stay in
the Threads view.

## Start a company

Click **New company** and give it a name, a mission, a CEO name, and a model. Pick where the
team works: a new project folder, or one of your existing projects. **Software team** adds a
CTO, two engineers, and QA with starter skills; **CEO recommends the team** has the CEO propose
who to hire for the mission, and you approve each person; **Just a CEO** lets you build the team
yourself. Each company has its own board, org chart, and skills; switch companies from the
menu at the top left.

The company's project is its home: agents work in that folder, and the board shows it beside the
mission. To make an existing repository the home, add its folder as a project, then pick it under
**Edit company** > **Workspace**. New tasks start in the new project; tasks that already started
stay where they are.

**Clone company** in the company menu starts a new company with the same team: departments,
skills, every employee and who they report to, and the board settings. Tasks, routines, and
history stay with the original. Turn on **Copy what they remember** to bring the company's and
employees' memory along too.

**Export company** in the same menu saves the team as a file: departments, every employee with
their instructions, skills, and model, who reports to whom, routines, and the board settings. Tasks
and history stay behind, and memory comes along only if you turn on **Include what they remember**.
To use the file, choose **Import a company** from the menu (or **Import from a file** before you
have a company) on any computer running T3 Code. Installed skills are matched by name; one that
isn't installed there comes along as the instructions from its SKILL.md. If an employee's model
isn't set up on that computer, you pick one for them while importing. Imported routines first run
one full interval after the import.

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
agent needs a role nobody has, it asks you: the request appears at the top of the org chart with
the role, department, manager, skills, instructions, and why the team needs them, and the agent
exists only after you choose **Hire**. To have the CEO propose the roles the company is missing,
use the **Ask … who to hire** button on the org chart. A proposed employee can report to another
proposed employee, such as engineers under a new CTO: they appear under that person, and you hire
the manager first. Declining a manager moves their proposed reports up to the manager's own
manager.

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

**Installed skills** on the same tab lists the skills your coding agents already have on the
computer the company runs on, such as Claude Code skills and plugins or Codex skills, along with
those in the company's project. **Add** one to put it in the library, then tick it on employees
like any other skill. An agent reads an installed skill from its own folder each time it uses it,
so it always follows the skill as installed now. Edit or update it where it is installed.

Agents can ask for skills too. An agent sees the library and the installed skills, and can ask for
one for itself or someone it manages; the request lands in your **Inbox** with why they need it.
**Add skill** puts an installed skill in the library and gives it to that employee; **Decline**
leaves everything as it was.

## How work flows

- A task in **To do** with an assignee starts that agent in a new thread, once every task it
  waits on is done. New tasks go to the CEO unless you pick someone else.
- A manager splits its task into subtasks for its reports and moves its own task to
  **Blocked**. Subtasks work in the parent task's worktree, so the parent's branch collects
  the whole result. When every subtask is done, the parent returns to **To do** and the
  manager continues.
- Work a manager delegates comes back to that manager for review: **Done** approves it;
  **To do** sends it back with requested changes, and the employee continues in its own
  thread.
- A task with no reviewer stops in **Review** for you. Tasks in **Ideas** never start on their
  own.
- Pick **You** as the assignee to keep a task for yourself, like a card on your own kanban
  board. No agent works on it, reviews it, or answers its comments; it moves only when you move
  it. Assign an employee to hand it off.
- When a subtask gets stuck in **Blocked**, its manager is started to unblock it: it answers the
  question, reassigns the subtask, or narrows it, and asks you on its own task when only you can
  help. A subtask that is only waiting on its own subtasks doesn't count as stuck.

Every agent is told where it works: the folder, the branch, the base it started from, which
other tasks share that folder, and that work from other tasks is only there once it is merged.
Branches are not merged for you, so a task that needs another task's work waits until you ship
it.

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
their context and each new message carries only what changed. A manager reviews each finished
subtask in its own thread for the parent task, so delegating adds no thread per review. Open a
task to see its activity, its runs, and links to each agent's thread.

Paste, drop, or attach pictures and other files in a comment, such as a screenshot of what is
wrong. They upload to the computer running T3 Code, so this works from a browser or another device
too. Claude and Codex agents see pictures as images; agents on other providers get each file's path
and open it themselves. Files stay with the comment until you delete the task.

Attach files a task needs, such as a video to edit from your Downloads folder, under **Files**
when you create the task or later in the task. In the desktop app, use **Add files** or drop them
in; in a browser, paste the file's full path. Nothing is uploaded: agents work from the files
where they are on the computer running T3 Code, and subtasks see their parent's files too.

A task lists its **Linked work**: its branch, and the pull requests, previews, and documents its
agents report, with each pull request's status. Remove a wrong link with its **×**.

## Tasks that wait on other tasks

Under **Waits on**, in a new task or an open one, pick the tasks that must be done first. The task
stays in **To do** until every one of them is **Done**, then starts on its own; its card says what
it waits on, and the task it waits on lists it under **Needed by**. Remove one with its **×** to stop
waiting. **Start agent** stays off while a task waits.

The agent that starts is told what came before: each task it waited on, with its branch and the last
summary its agent left. Work a task did in its own worktree is only in the next task's folder once
it is merged, so the agent merges that branch into its own when it needs it. Subtasks of one task
share its worktree, so a subtask that waits on another already has its work. Managers set these up
themselves when they split work into steps that build on each other.

## Ship finished work

A task with a branch of its own shows **Ship** once it is in **Review** or **Done** and no agent
is working in its worktree. Subtasks share their parent's branch, so they ship with the parent.

- **Open pull request** commits anything the agents left uncommitted, pushes the branch, and opens
  a pull request, the same way the git button in a chat does. Its status stays current under
  **Linked work**, and so do pull requests the task's agent opens on its own.
- **Merge** merges the branch into whatever branch your project folder has checked out, on the
  computer running T3 Code. It doesn't push. It stops if the folder has uncommitted changes, and
  if the branch conflicts it merges nothing, so you can ask the agent in a comment to merge your
  branch into its own first, or open a pull request instead.

When the work lands, by a merge here or once its pull request is merged, a task waiting in
**Review** moves to **Done**.

A task in **Review** also offers **Merge and finish**, which works even when the task has no branch
of its own: the task's agent merges its pull request or branch into the branch your project
folder has checked out and fixes any conflicts itself. The task moves to **Done** when the agent
finishes; if it can't merge, it moves the task to **Blocked** and says why. **Mark done** moves
the task to **Done** without merging anything.

## Archive finished tasks

Open a task in **Done** and choose **Archive**, or use **Archive all** at the top of **Done**.
Subtasks are archived with their task, and its agents' threads settle. A finished subtask can also
be archived on its own while its task is still open. To bring one back, show the
archived tasks from the top of **Done**, open the task, and choose **Restore**. A task that moves
out of **Done** comes back on its own. The dashboard still counts archived tasks.

## Routines

The **Routines** tab adds a task on a schedule, such as a weekly review for the CEO: pick the
title, what to do, who does it, how often it repeats, and when it next runs. If the last task a
routine added is still open when it comes due, it waits for the next turn instead of adding
another. A routine with nobody assigned adds its task to **Ideas**, and one assigned to **You**
adds a recurring to-do to your **To do**. Each routine shows when it
last ran and links to the task it created; **Run now** adds its task right away without changing
the schedule.

## Spending limits

Set a monthly token limit for the whole company under **Edit company**, or for one employee in
their editor. Limits count input plus output tokens per calendar month (UTC), the same total the
dashboard shows. From 80% the org chart and board warn you; at the limit, agents aren't started
until you raise it or the month ends. An agent already running finishes its run.

## Inbox

**Inbox**, beside the dashboard, lists what waits on you in every company, oldest first:

- tasks in **Review** that you review, or whose reviewer finished without deciding
- top-level tasks stuck in **Blocked** with nothing below them still moving
- hire requests
- skill requests, which you decide right in the Inbox
- your own to-dos in **To do**

Select an item to open its task, or the org chart for a hire. The sidebar's **Companies** button
shows how many items are waiting. When something new arrives, T3 Code alerts you the way it does for
threads, following **Settings → General → Notifications**: a system notification while the app is
in the background, or an in-app toast while it has focus if **In-app notifications** is on. Board
items do not reach your phone yet; the agents' own threads still alert there as they finish.

## Dashboard

**Dashboard** shows how the company is doing: open and finished tasks, who is working now, how
often runs succeed, how long tasks take from creation to done, and the tokens spent. Below that
are daily activity for the last 14 days, a **Needs attention** list (blocked or unassigned tasks,
hire requests, failed runs), a breakdown by model and by department, and a row for every
employee. A failed run opens its thread, and leaves the list once that thread runs again, from the
board or from the thread itself, or once it settles.

**Open worktrees** counts the company's task worktrees still on disk. Select it to see each main
task and its subtasks, and which ones have to reach Done before those worktrees can be removed.

Tokens are counted from each employee's board threads and credited to the model that thread ran.
A running agent's tokens appear when its run ends. Days start at midnight in your time zone.

## Timeline

**Timeline**, beside the board, tells the company's story. **Tasks** charts two weeks at a time:
each task is a bar from when it was created until it was done, colored by its column, with the
faces of everyone who worked on it or its subtasks. Open tasks run up to today's line. Step back a
week at a time, or use the arrow on a bar that runs off the edge to jump to its start or end.
Tasks in **Ideas** stay off the chart.

**Updates** lists the last 30 days by day: tasks created, the board's updates such as who started
or finished, and the pull requests, branches, and previews agents linked. **Git** shows the branch
your project folder has checked out: its commits, newest first, with each merge tied to the task
that made it, and the pull requests and task branches still waiting to merge. A company working in
several projects can switch between them. Open any task from any view.

## Board settings

The board's settings menu controls:

- **Auto-run agents**: turn off to start tasks only with **Start agent** on a task.
- **Worktree per task**: each top-level task gets its own worktree on a `board/<task>` branch
  from the project's current `HEAD`. Turn off to let agents share the project checkout.
  Once a task and all its subtasks are done, or the task is archived, the next cleanup removes
  their worktrees. Branches stay, worktrees with uncommitted work are kept, and reopening the task
  recreates its checkout.
- **Agents at once**: how many tasks can run at the same time. Ready tasks wait for a slot.
