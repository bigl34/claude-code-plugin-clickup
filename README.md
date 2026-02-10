<!-- AUTO-GENERATED README — DO NOT EDIT. Changes will be overwritten on next publish. -->
# claude-code-plugin-clickup

ClickUp task management and sprint tracking

![Version](https://img.shields.io/badge/version-1.1.9-blue) ![License: MIT](https://img.shields.io/badge/License-MIT-green) ![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## Features

- Task
- **search** — Search for tasks (fuzzy matching)
- **get-task** — Get task details by ID
- **get-task-description** — Get task with full markdown description (incl. URL previews)
- **create-task** — Create a new task
- **update-task** — Update a task
- **add-comment** — Add a comment to a task
- **get-comments** — Get comments on a task
- Space/List
- **search-spaces** — Search spaces (projects)
- **get-list** — Get list details
- Time Tracking
- **get-time-entries** — Get time entries
- **create-time-entry** — Create a time entry

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- API credentials for the target service (see Configuration)

## Quick Start

```bash
git clone https://github.com/YOUR_GITHUB_USER/claude-code-plugin-clickup.git
cd claude-code-plugin-clickup
cp config.template.json config.json  # fill in your credentials
cd scripts && npm install
```

```bash
node scripts/dist/cli.js search
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

| Command                | Description                                                  | Options                                                                                           |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `search`               | Search for tasks (fuzzy matching)                            | `--query`, `--assigned-to-me`, `--exclude-closed`, `--list`, `--space`                            |
| `get-task`             | Get task details by ID                                       | `--id` (required)                                                                                 |
| `get-task-description` | Get task with full markdown description (incl. URL previews) | `--id` (required)                                                                                 |
| `create-task`          | Create a new task                                            | `--list` (required), `--name` (required), `--description`, `--priority`, `--status`, `--due-date` |
| `update-task`          | Update a task                                                | `--id` (required), `--name`, `--description`, `--priority`, `--status`, `--due-date`              |
| `add-comment`          | Add a comment to a task                                      | `--id` (required), `--comment` (required)                                                         |
| `get-comments`         | Get comments on a task                                       | `--id` (required)                                                                                 |

### Space/List Commands

| Command         | Description              | Options                       |
| --------------- | ------------------------ | ----------------------------- |
| `search-spaces` | Search spaces (projects) | `--query`                     |
| `get-list`      | Get list details         | `--id` or `--list` (required) |

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
| `--query <text>`         | Search query (supports fuzzy matching)                      |
| `--name <name>`          | Task name                                                   |
| `--description <text>`   | Task description                                            |
| `--priority <1-4>`       | Priority (1=urgent, 2=high, 3=normal, 4=low)                |
| `--status <status>`      | Task status                                                 |
| `--due-date <timestamp>` | Due date (Unix timestamp in ms)                             |
| `--comment <text>`       | Comment text                                                |
| `--hours <number>`       | Hours for time entry (decimal, e.g., 0.5 for 30 min)        |
| `--assigned-to-me`       | Filter to tasks assigned to current user                    |
| `--exclude-closed`       | Exclude closed/done tasks from search (included by default) |

## Usage Examples

```bash
# Search for tasks (fuzzy matching - fast!)
node scripts/dist/cli.js search --query "Customer Name"

# Search for my assigned tasks
node scripts/dist/cli.js search --assigned-to-me

# Get a specific task
node scripts/dist/cli.js get-task --id "86c7955c1"

# Create a new task
node scripts/dist/cli.js create-task --list "12345678" --name "New task" --priority 2

# Update a task status
node scripts/dist/cli.js update-task --id "abc123" --status "complete"

# Add a comment to a task
node scripts/dist/cli.js add-comment --id "abc123" --comment "Progress update here"

# Search for spaces/projects
node scripts/dist/cli.js search-spaces --query "Personal"

# Log time on a task (0.5 = 30 minutes)
node scripts/dist/cli.js create-time-entry --id "abc123" --hours 0.5 --description "Code review"
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
