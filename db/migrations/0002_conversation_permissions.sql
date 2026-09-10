CREATE TABLE IF NOT EXISTS conversation_permissions (
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  addresses TEXT NOT NULL,
  revision TEXT NOT NULL,
  PRIMARY KEY (user_id, workspace_id)
);
