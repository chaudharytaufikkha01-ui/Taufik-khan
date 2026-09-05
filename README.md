# Taufik Khan Secure Portal

A Cloudflare Workers + D1 starter with:
- Sign up
- Login/logout
- Profile changes
- Messages
- Form submissions
- Admin activity feed
- Admin user list
- Optional browser notifications for the admin panel

## Important
This records the actions listed above. It does NOT secretly track device location, contacts, or unrelated browsing.

## Deploy
1. Create a Cloudflare D1 database named `taufik-portal-db`.
2. Put its ID in `wrangler.toml`.
3. Run:
   `npx wrangler d1 migrations apply taufik-portal-db --remote`
4. Set secrets:
   `npx wrangler secret put ADMIN_EMAIL`
   `npx wrangler secret put ADMIN_PASSWORD`
5. Deploy:
   `npx wrangler deploy`

Keep ADMIN_PASSWORD private and use a strong unique password.
