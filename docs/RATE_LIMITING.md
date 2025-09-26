# Rate Limiting Implementation

This document describes the comprehensive rate limiting system implemented for production readiness.

## Overview

The rate limiting system provides multiple layers of protection:
- **Global rate limiting** - Overall request protection per IP
- **Endpoint-specific limits** - Tailored limits for different operations
- **Comprehensive logging** - Rate limit violations tracking
- **Proper HTTP headers** - Client-friendly rate limit information

## Configuration

Rate limiting is controlled via environment variables with sensible defaults:

```bash
# Enable/disable rate limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_STORE_PROVIDER=memory

# Global limits (applies to all requests)
RATE_LIMIT_GLOBAL_MAX=1000              # 1000 requests per minute per IP
RATE_LIMIT_GLOBAL_WINDOW=60000          # 60 second window

# Order creation limits (most restrictive)
RATE_LIMIT_ORDER_CREATE_MAX=10          # 10 orders per minute per IP
RATE_LIMIT_ORDER_CREATE_WINDOW=60000    # 60 second window

# Order reading limits (more permissive)
RATE_LIMIT_ORDER_READ_MAX=100           # 100 reads per minute per IP
RATE_LIMIT_ORDER_READ_WINDOW=60000      # 60 second window

# Status update limits (moderate)
RATE_LIMIT_ORDER_STATUS_MAX=50          # 50 status updates per minute per IP
RATE_LIMIT_ORDER_STATUS_WINDOW=60000    # 60 second window

# Redis-backed store (optional)
RATE_LIMIT_STORE_PROVIDER=redis
RATE_LIMIT_REDIS_HOST=redis.example.com
RATE_LIMIT_REDIS_PORT=6379
RATE_LIMIT_REDIS_USERNAME=
RATE_LIMIT_REDIS_PASSWORD=
RATE_LIMIT_REDIS_DB=0
RATE_LIMIT_REDIS_TLS=false

> Redis mode requires the optional dependency `ioredis` to be installed. When Redis is unreachable the service logs connection errors and continues retrying; set `RATE_LIMIT_STORE_PROVIDER=memory` when Redis is not available.
```

## Architecture

### Tiered Rate Limiting Strategy

1. **Global Layer**: Catches excessive traffic from any single IP
2. **Endpoint Layer**: Applies business-logic-specific limits
3. **Key Differentiation**: Different rate limit buckets per operation type

### Rate Limit Enforcement

- **Order Creation**: Most restrictive (10/min) - prevents spam orders
- **Order Reading**: Generous (100/min) - allows legitimate order tracking
- **Status Updates**: Moderate (50/min) - balances delivery system callbacks
- **Global Backstop**: High limit (1000/min) - catches unusual traffic patterns

## Response Handling

### Rate Limit Headers

Responses include standard rate limiting headers supplied by `@fastify/rate-limit`:
```
x-ratelimit-limit: 10
x-ratelimit-remaining: 7
x-ratelimit-reset: 1640995200
```

### Error Responses

When rate limits are exceeded, clients receive structured 429 responses:
```json
{
  "error": "Order Creation Rate Limit Exceeded",
  "message": "Too many order creation attempts. Limit: 10 per 60 seconds. Please try again later.",
  "statusCode": 429,
  "retryAfter": 45,
  "limit": 10,
  "reset": "2024-01-01T12:30:00.000Z"
}
```

## Implementation Details

### Plugin Architecture

- **`src/plugins/rate-limit.ts`**: Core rate limiting plugin
- **Fastify Integration**: Uses `@fastify/rate-limit` v9.1.0
- **Route-Specific Config**: Applied per endpoint via route configuration

### Key Features

1. **IP-Based Keying**: Default rate limiting by client IP address
2. **Graceful Degradation**: Empty configs when disabled
3. **Comprehensive Logging**: Warnings on limit approaching/exceeded
4. **Custom Error Messages**: Business-context-specific error responses

### Route Integration

Routes specify their specific rate limiting configuration:
```typescript
fastify.post('/orders', {
  config: {
    rateLimit: fastify.rateLimiters.orderCreate.config
  }
  // ... other route options
});
```

### Testing

The current test suite focuses on core order flows. Rate limiting is verified manually via curl/Autocannon runs; automated coverage is a planned enhancement.

## Production Considerations

### Monitoring

The system logs rate limit events for monitoring:
- **Approaching Limits**: Warning when clients near their limits
- **Limit Exceeded**: Full logging with client details and context

### Scalability

- **In-Memory Counters**: Default in-process store (sufficient for single-instance deployments)
- **Redis Store (Optional)**: Configure `RATE_LIMIT_STORE_PROVIDER=redis` for cross-instance enforcement.
  - In docker-compose, enable the Redis service with `--profile redis-rate-limit`.
- **Stateless**: Rate limits stored in memory (can be enhanced with Redis)
- **Horizontal Scaling**: Each instance maintains independent counters

### Security Benefits

1. **DDoS Protection**: Prevents overwhelming the service
2. **Resource Conservation**: Protects database and downstream services
3. **Fair Usage**: Ensures equitable access for all clients
4. **Abuse Prevention**: Stops malicious order creation attempts

## Future Enhancements

1. **Redis Backend**: Shared rate limiting across multiple instances
2. **User-Based Limits**: Authentication-aware rate limiting
3. **Dynamic Limits**: Adjust limits based on system load
4. **Whitelist/Blacklist**: IP-based exceptions for trusted/blocked clients
5. **Business Logic Integration**: Customer tier-based rate limits

## Usage Examples

### Normal Operations
```bash
# Create orders within limits - succeeds
for i in {1..5}; do
  curl -X POST http://localhost:3000/v1/orders \
    -H "Idempotency-Key: test-$i" \
    -H "Content-Type: application/json" \
    -d '{"customerId":"test","totalAmount":100,"items":[{"sku":"test","qty":1}]}'
done
```

### Rate Limit Exceeded
```bash
# 11th request within 1 minute - fails with 429
curl -X POST http://localhost:3000/v1/orders \
  -H "Idempotency-Key: test-overflow" \
  -H "Content-Type: application/json" \
  -d '{"customerId":"test","totalAmount":100,"items":[{"sku":"test","qty":1}]}'
```

### Disabling Rate Limiting
```bash
# For development/testing
export RATE_LIMIT_ENABLED=false
npm run dev
```

## Integration with Existing Features

- **Idempotency**: Rate limits work alongside idempotency keys
- **Error Handling**: Uses existing HTTP error framework
- **Logging**: Integrates with structured logging system
- **Health Checks**: Rate limiting doesn't affect health endpoints
- **Debug Routes**: Debug endpoints inherit global rate limits only
