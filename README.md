<!-- AUTO-GENERATED README — DO NOT EDIT. Changes will be overwritten on next publish. -->
# claude-code-plugin-clickup

ClickUp task management and sprint tracking

![Version](https://img.shields.io/badge/version-1.3.0-blue) ![License: MIT](https://img.shields.io/badge/License-MIT-green) ![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## Features

- Task
- **search** — Search for tasks (fuzzy matching)
- **get-task** — Get task details by ID
- **get-task-description** — Get task with full markdown description (incl. URL previews)
- **create-task** — Create a new task
- **create-sprint-task** — Create a task in the current User To Dos sprint (defaults status to `to do`)
- **update-task** — Update a task
- **add-comment** — Add a comment to a task
- **get-comments** — Get comments on a task
- Space/List
- **search-spaces** — Search spaces (projects)
- **get-list** — Get list details
- **list-lists** — List ClickUp lists with IDs and folder/date metadata
- **list-folder-tasks** — List every active task across all lists in one folder for backlog dedupe
- **current-sprint** — Resolve the current User To Dos sprint list
- Time Tracking
- **get-time-entries** — Get time entries
- **create-time-entry** — Create a time entry

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- API credentials for the target service (see Configuration)

## Quick Start

```bash
git clone https://github.com/bigl34/claude-code-plugin-clickup.git
cd claude-code-plugin-clickup
cp config.template.json config.json  # fill in your credentials
npm --prefix scripts install
```

```bash
npm --prefix scripts run cli -- search
```

## Installation

1. Clone this repository
2. Copy `config.template.json` to `config.json` and fill in your credentials
3. Install dependencies:
   ```bash
   cd scripts && npm install
   ```

## Available Commands

### Task Commands

| Command                | Description                                                                  | Options                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `search`               | Search for tasks (fuzzy matching)                                            | `--query`, `--exclude-closed`, `--list`, `--space`, `--page`                                      |
| `get-task`             | Get task details by ID                                                       | `--id` (required)                                                                                 |
| `get-task-description` | Get task with full markdown description (incl. URL previews)                 | `--id` (required)                                                                                 |
| `create-task`          | Create a new task                                                            | `--list` (required), `--name` (required), `--description`, `--priority`, `--status`, `--due-date` |
| `create-sprint-task`   | Create a task in the current User To Dos sprint (defaults status to `to do`) | `--name` (required), `--description`, `--priority`, `--status`, `--due-date`                      |
| `update-task`          | Update a task                                                                | `--id` (required), `--name`, `--description`, `--priority`, `--status`, `--due-date`              |
| `add-comment`          | Add a comment to a task                                                      | `--id` (required), `--comment` (required)                                                         |
| `get-comments`         | Get comments on a task                                                       | `--id` (required)                                                                                 |

### Space/List Commands

| Command             | Description                                                              | Options                       |
| ------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| `search-spaces`     | Search spaces (projects)                                                 | `--query`                     |
| `get-list`          | Get list details                                                         | `--id` or `--list` (required) |
| `list-lists`        | List ClickUp lists with IDs and folder/date metadata                     | none                          |
| `list-folder-tasks` | List every active task across all lists in one folder for backlog dedupe | `--folder` (required)         |
| `current-sprint`    | Resolve the current User To Dos sprint list                              | none                          |

### Time Tracking Commands

| Command             | Description         | Options                                                  |
| ------------------- | ------------------- | -------------------------------------------------------- |
| `get-time-entries`  | Get time entries    | `--id` (task ID, optional)                               |
| `create-time-entry` | Create a time entry | `--id` (required), `--hours` (required), `--description` |

### Common Options

| Option                   | Description                                                 |
| ------------------------ | ----------------------------------------------------------- |
| `--id <id>`              | Task ID                                                     |
| `--list <id>`            | List ID                                                     |
| `--space <id>`           | Space ID                                                    |
| `--page <number>`        | Zero-based task-search page                                 |
| `--query <text>`         | Search query (supports fuzzy matching)                      |
| `--name <name>`          | Task name                                                   |
| `--description <text>`   | Task description                                            |
| `--priority <1-4>`       | Priority (1=urgent, 2=high, 3=normal, 4=low)                |
| `--status <status>`      | Task status                                                 |
| `--due-date <timestamp>` | Due date (Unix timestamp in ms)                             |
| `--comment <text>`       | Comment text                                                |
| `--hours <number>`       | Hours for time entry (decimal, e.g., 0.5 for 30 min)        |
| `--exclude-closed`       | Exclude closed/done tasks from search (included by default) |

## Usage Examples

```bash
# Search for tasks (fuzzy matching - fast!)
npm --prefix "scripts" run cli -- search --query "Customer Name"

# Enumerate every active task in a folder before creating a possible duplicate
npm --prefix "scripts" run cli -- list-folder-tasks --folder "FOLDER_ID"

# Get a specific task
npm --prefix "scripts" run cli -- get-task --id "YOUR_TASK_ID"

# Create a new task
npm --prefix "scripts" run cli -- create-task --list "12345678" --name "New task" --priority 2

# Create a task in the current User To Dos sprint (defaults to "to do")
npm --prefix "scripts" run cli -- create-sprint-task --name "Order in covers"

# Update a task status
npm --prefix "scripts" run cli -- update-task --id "abc123" --status "complete"

# Add a comment to a task
npm --prefix "scripts" run cli -- add-comment --id "abc123" --comment "Progress update here"

# Resolve/debug the current sprint list
npm --prefix "scripts" run cli -- current-sprint

# Log time on a task (0.5 = 30 minutes)
npm --prefix "scripts" run cli -- create-time-entry --id "abc123" --hours 0.5 --description "Code review"
```

## How It Works

This plugin connects directly to the service's HTTP API. The CLI handles authentication, request formatting, pagination, and error handling, returning structured JSON responses.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Authentication errors | Verify credentials in `config.json` |
| `ERR_MODULE_NOT_FOUND` | Run `cd scripts && npm install` |
| Rate limiting | The CLI handles retries automatically; wait and retry if persistent |
| Unexpected JSON output | Check API credentials haven't expired |

## Known Limitations

**ClickUp's API does not support moving tasks between lists.** Once a task is created in a list, it cannot be moved programmatically. This is a known ClickUp API limitation since 2019.

**Implications:**
- Always create tasks in the correct list from the start
- If a task needs to be moved, the user must do it manually in the ClickUp web UI
- Do NOT attempt to use `update-task --list` - it will silently fail

## Contributing

Issues and pull requests are welcome.

## License

MIT
