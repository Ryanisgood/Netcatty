"use strict";

const NETCATTY_MCP_SERVER_INSTRUCTIONS =
  "Use Netcatty tools whenever the user asks to inspect or operate Netcatty, a terminal tab, remote host/server, SSH/Mosh/Telnet/serial session, SFTP file, vault host, snippet/script, or port forward. For a live terminal task, call get_environment first, select the target by label or hostname, and pass its sessionId to terminal_execute or terminal_start. Never use the local shell for a command intended for a Netcatty session. Use vault_hosts_list and host_open when no matching live session exists.";

module.exports = { NETCATTY_MCP_SERVER_INSTRUCTIONS };
