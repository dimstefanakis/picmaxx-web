# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Picmaxx Next.js App Router project. PostHog is initialized client-side via `instrumentation-client.ts` (the recommended approach for Next.js 15.3+) and server-side via a shared singleton in `src/lib/posthog-server.ts`. A reverse proxy is configured in `next.config.ts` so all analytics traffic routes through `/ingest` on the same domain, improving ad-blocker resilience and data accuracy. User identification runs at both the checkout initiation step (client-side, using the email entered in the form) and the waitlist signup route (server-side). Error tracking is enabled globally via `capture_exceptions: true` in the PostHog init.

| Event Name | Description | File |
|---|---|---|
| `package_selected` | User selects a photo test package (best_of_three or single) | `src/app/test/page.tsx` |
| `package_selected` | User selects a photo test package on the ad landing variant | `src/app/photo-test/page.tsx` |
| `photo_upload_added` | User successfully adds a photo to their test submission | `src/app/test/page.tsx` |
| `photo_upload_added` | User successfully adds a photo on the ad landing variant | `src/app/photo-test/page.tsx` |
| `checkout_initiated` | User is redirected to Stripe checkout after photos are uploaded and validated | `src/app/test/page.tsx` |
| `checkout_initiated` | User is redirected to Stripe checkout on the ad landing variant | `src/app/photo-test/page.tsx` |
| `purchase_completed` | User lands on the success page after completing payment (client-side) | `src/app/test/success/page.tsx` |
| `photo_test_order_created` | Server creates a new photo test order record and generates upload URLs | `src/app/api/photo-tests/init/route.ts` |
| `photo_test_checkout_started` | Server creates a Stripe checkout session for a photo test order | `src/app/api/photo-tests/checkout/route.ts` |
| `photo_test_purchase_confirmed` | Stripe webhook confirms payment and marks the order as paid | `src/app/api/stripe/webhook/route.ts` |
| `waitlist_signup_submitted` | User submits their email to join the PicMaxx waitlist | `src/app/api/waitlist/route.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/484232/dashboard/1754961)
- [Photo Test Checkout Funnel](https://us.posthog.com/project/484232/insights/ad8kFMzb)
- [Purchases Over Time](https://us.posthog.com/project/484232/insights/cIvNVIWu)
- [Checkout Initiations vs Purchases](https://us.posthog.com/project/484232/insights/S6xqBjhl)
- [Full Order Funnel](https://us.posthog.com/project/484232/insights/i7oVtIkY)
- [Waitlist Signups Over Time](https://us.posthog.com/project/484232/insights/XDTtfMti)

## Verify before merging

- [ ] Run a full production build (`bun run build`) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` to `.env.example` and any bootstrap/onboarding scripts so collaborators know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify in PostHog error tracking.
- [ ] Confirm the returning-visitor path also calls `identify` — currently `identify` is called at checkout initiation and waitlist signup, but a user who returns after a previous purchase will remain anonymous until they submit a form again.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
