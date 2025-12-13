---
'payload-plugin-webhooks': minor
---

Add API Keys collection for webhook stream authentication

- Add new `api-keys` collection with user relationship
- Implement one API key per user restriction with proper validation error handling
- Add custom field component with generate, copy-to-clipboard, and show/hide visibility toggle
- Add obfuscated display in list view for security
- Update `streamAuth` to validate against API keys collection and track `lastUsed` timestamp
- Group both webhooks configuration and API keys under "Webhooks" admin group
- Use Payload ValidationError for better UX when user already has an API key
