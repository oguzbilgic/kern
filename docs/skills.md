# Skills

Skills are reusable instruction packages that extend an agent's capabilities. Each skill is a folder containing a `SKILL.md` file with frontmatter metadata and markdown instructions.

## Directories

Skills are loaded from two directories:

| Directory | Purpose | Version controlled |
|---|---|---|
| `skills/` | Agent-created skills | Yes |
| `.agents/skills/` | Installed from registries | No |

## SKILL.md format

```markdown
---
name: deploy-lxc
description: Create and configure Debian 12 LXC containers on Proxmox
---

# Deploy LXC

Step-by-step instructions, commands, checklists, etc.
```

The frontmatter `name` and `description` are optional — if omitted, the folder name is used and description is empty.

## How it works

### Catalog injection

A compact catalog of all available skills is always present in the agent's system prompt:

```
# Available Skills
- deploy-lxc: Create and configure Debian 12 LXC containers on Proxmox
- backup-db: Backup PostgreSQL databases to S3
```

This costs ~50-100 tokens per skill and lets the agent know what's available without loading full instructions.

### Activation

When the agent activates a skill, the full `SKILL.md` body is injected into the system prompt. This persists across turns until explicitly deactivated. Active skills are never subject to conversation trimming.

Skills are in-memory only — they reset on agent restart.

### Rescanning

Skill directories are rescanned every turn. If the agent creates a new `skills/foo/SKILL.md` mid-session, it appears in the catalog immediately on the next turn.

## Skill tool

The `skill` tool has three actions:

| Action | Description |
|---|---|
| `list` | Show all skills with active/inactive status |
| `activate` | Load a skill's full instructions into system prompt |
| `deactivate` | Unload a skill to free token budget |

## Slash command

`/skills` lists all available skills with active/inactive status icons. This command is registered by the skills plugin and appears in web UI autocomplete automatically.

## API

| Endpoint | Description |
|---|---|
| `GET /skills` | List all skills with name, description, source, active status |
| `GET /skills/:name` | Skill detail including full body |

## Creating a skill

1. Create a folder in `skills/`:
   ```
   skills/my-skill/SKILL.md
   ```

2. Add frontmatter and instructions:
   ```markdown
   ---
   name: my-skill
   description: What this skill does
   ---

   # My Skill

   Instructions the agent follows when this skill is active.
   ```

3. The skill appears in the catalog on the next turn — no restart needed.

## Installing skills

Skills from external registries are installed into `.agents/skills/`. This directory follows the [AgentSkills](https://agentskills.io/) convention shared across agent frameworks.

Registry search and install commands are planned for a future release.
