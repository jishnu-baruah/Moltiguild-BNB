# Coordinator Agent Configuration

## Agent ID
coordinator

## Workspace
~/.openclaw/workspace-coordinator

## Tools Allowed
- exec (run shell commands)
- read (read files)
- write (write files)
- sessions_spawn (create new agent sessions)
- sessions_send (send messages to existing sessions)
- sessions_list (list active sessions)
- sessions_history (view session history)
- session_status (check session status)

## Model
kimi-k2.5:cloud

## Purpose
Central orchestrator for all AgentGuilds operations. Routes missions, delegates to specialist agents, records results on-chain.
