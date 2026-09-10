CREATE TABLE IF NOT EXISTS conversation_permissions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  addresses TEXT NOT NULL,
  revision TEXT NOT NULL,
  PRIMARY KEY (user_id, workspace_id)
);
