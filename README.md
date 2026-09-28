# PakCart — Full-Stack Marketplace Starter

A Pakistan-focused multi-vendor marketplace foundation with:
- Customer, seller and admin roles
- SQLite database
- JWT authentication
- Product/category/order CRUD
- Admin-wide visibility
- Dynamic homepage sections and cards
- Inventory tracking
- Marketplace commission
- Analytics endpoints
- COD checkout
- Stripe Checkout integration when `STRIPE_SECRET_KEY` is configured
- Responsive frontend with a navigation bar and admin control center

## Run
1. Install Node.js 18+.
2. Copy `.env.example` to `.env` and change the secret/password.
3. Run `npm install`
4. Run `npm start`
5. Open `http://localhost:3000`

Default admin credentials come from `.env`.

## Important production steps
Use HTTPS, rotate JWT secrets, set a strong admin password, configure Stripe webhook signing, add a real transactional email/SMS provider, object storage for product images, backups, rate limiting, audit logs, and a production database such as PostgreSQL before public launch.
