# qaos Tasks

## Completed (recent)

- [x] Replace per-session mode selector with app-level deployment mode direction.
- [x] Introduce `qaos.config.ts` as app config source (deployment mode).
- [x] Keep runtime mode aliases for backward compatibility (`server`→`single`, `local`→`hybrid`).
- [x] Remove theme storage writes from runtime config seed/bootstrap paths.
- [x] Hide theme controls from Settings UI.
- [x] Align docs with `single`/`hybrid` terminology and current architecture.
- [x] Standardize on config-based routing only (`app/routes.ts` is route source of truth; no file-based auto-routing).
- [x] Migrate to stateless JWT authentication and implement RBAC (admin/user).
- [x] Local executor production readiness (transport, command lifecycle, reliability, security, observability).

## Pending

- [ ] Remove user registration feature. The default admin user will created by the create-qaos-app(to be created) npm package during initial project setup. The admin user will have full access to all features. And the normal users will be created by the admin user on qaos's admin dashboard.
- [ ] Add user preference for theme config.
- [ ] Add test suite feature, so different test chats can be grouped into different test suites, 1 test suite can have multiple test chats, 1 test chat can belong to multiple test suites.
