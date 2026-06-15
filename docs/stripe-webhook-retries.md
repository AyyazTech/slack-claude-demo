# Stripe Webhook Retry Handling

## Problem

Stripe webhook retries are causing duplicate delivery of `invoice.payment_succeeded` events. Our naive handler processes each delivery independently, resulting in double-charging credit.

## Solution

We've converged on a three-part approach that ensures exactly-once semantics without introducing additional infrastructure:

### 1. Idempotency Table

Create a `processed_events` table with `event.id` as the primary key. Before processing any webhook, check if the event ID already exists:

- If exists: short-circuit and return 200 immediately
- If not: proceed with processing

This leverages Stripe's built-in `event.id` which is unique per event.

### 2. Transactional Handler

Wrap the entire webhook handler in a single database transaction. This ensures all-or-nothing execution:

- Credit adjustments, record updates, and the idempotency insert all happen atomically
- If any step fails, the entire transaction rolls back
- Partial failures (event marked processed but downstream effect never happened) are eliminated

### 3. Return 200 Only After Commit

Only return HTTP 200 after the transaction successfully commits. This ensures:

- A 200 response means the event was durably handled
- If processing fails, Stripe will retry (they use exponential backoff over ~3 days)
- No false positives where Stripe thinks delivery succeeded but processing failed

## Why Not a Queue?

A queue-based approach (SQS, Kafka, etc.) with at-least-once delivery and idempotent consumers was considered but deemed overkill for our current volume. The transactional approach achieves the same guarantees with less infrastructure complexity.

## Stripe's Retry Behavior

Stripe automatically retries failed webhook deliveries with exponential backoff over approximately 3 days. We don't need to implement retry logic ourselves - we just need to ensure our 200 response genuinely means "durably handled."
