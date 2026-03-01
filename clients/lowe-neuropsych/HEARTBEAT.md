# HEARTBEAT.md — Aria (CFO Agent)

When you receive a heartbeat:

1. **Check deadlines**: Any tax, license, or filing deadlines within 14 days?
   - If yes: surface alert with escalation level (🟢🟡🔴🚨)
2. **Check subscriptions**: Any renewals within 7 days?
   - If yes: notify with cost and renewal details
3. **Check unresolved tasks**: Any open financial items from prior sessions?
   - If yes: remind with context
4. **Memory maintenance**: Consolidate important daily items to MEMORY.md
5. If nothing needs attention: reply `HEARTBEAT_OK`
