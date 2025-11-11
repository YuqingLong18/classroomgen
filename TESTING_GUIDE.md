# Testing Guide for Performance Optimizations

This document outlines the testing steps to verify all performance optimizations are working correctly.

## Pre-Testing Setup

1. **Install dependencies** (if any new ones were added):
   ```bash
   npm install
   ```

2. **Run database migrations** (if schema changed):
   ```bash
   npx prisma migrate dev
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

## Critical Functionality Tests

### 1. Image Serving Endpoint Test

**Objective**: Verify images are served via separate endpoint, not in JSON responses.

**Steps**:
1. Log in as a student
2. Generate an image
3. Open browser DevTools → Network tab
4. Check `/api/images` response:
   - ✅ Should NOT contain `imageData` field
   - ✅ Response should be <100KB (previously 10-50MB+)
   - ✅ Response time should be <500ms (previously 449s+)
5. Check image loading:
   - ✅ Images should load from `/api/images/[id]/image`
   - ✅ Images should display correctly
   - ✅ Image URLs should work when accessed directly

**Expected Results**:
- `/api/images` response: Small JSON without base64 data
- Image endpoint: Returns binary image data with proper headers
- Images display correctly in UI

### 2. Async Image Generation Test

**Objective**: Verify image generation is non-blocking and uses job queue.

**Steps**:
1. Log in as a student
2. Generate multiple images simultaneously (3-5 requests)
3. Observe:
   - ✅ All requests return immediately (<1s) with job ID
   - ✅ Images show "Generating..." status
   - ✅ Images complete generation asynchronously
   - ✅ No 502 timeout errors
   - ✅ Status updates automatically when complete

**Expected Results**:
- POST `/api/images/generate` returns immediately with `jobId`
- Frontend polls for completion
- Multiple generations can run concurrently
- No blocking/timeouts

### 3. Pagination Test

**Objective**: Verify pagination works correctly.

**Steps**:
1. Generate 60+ images (or use existing data)
2. Check `/api/images?page=1&limit=50`:
   - ✅ Returns first 50 images
   - ✅ Response includes `pagination` object
   - ✅ `hasMore: true` if more pages exist
3. Check `/api/images?page=2&limit=50`:
   - ✅ Returns next page of images
   - ✅ No duplicates from page 1

**Expected Results**:
- Pagination metadata in response
- Correct page limits
- No duplicate entries across pages

### 4. Caching Test

**Objective**: Verify caching reduces database load.

**Steps**:
1. Open DevTools → Network tab
2. Load `/api/images` multiple times quickly
3. Check response headers:
   - ✅ `X-Cache: HIT` on subsequent requests (within 5 seconds)
   - ✅ `X-Cache: MISS` on first request
   - ✅ `Cache-Control` header present
4. Verify cache invalidation:
   - Generate new image
   - Check that cache is cleared (next request shows MISS)

**Expected Results**:
- Cached responses return faster
- Cache headers present
- Cache invalidates on updates

### 5. Rate Limiting Test

**Objective**: Verify rate limiting prevents abuse.

**Steps**:
1. Rapidly send 10+ requests to `/api/images/generate` (within 1 minute)
2. After 5 requests, should receive:
   - ✅ Status 429 (Too Many Requests)
   - ✅ `X-RateLimit-Remaining: 0`
   - ✅ `Retry-After` header
3. Wait 60 seconds, try again:
   - ✅ Should work again

**Expected Results**:
- Rate limit enforced (5 requests/min for generation)
- Proper error messages
- Rate limit resets after window

### 6. Performance Under Load Test

**Objective**: Verify system handles 20 concurrent users.

**Steps**:
1. Open 20 browser tabs/windows
2. Log in as different students (or same student in different tabs)
3. Have all students:
   - Generate images simultaneously
   - Browse gallery
   - Like/share images
4. Monitor:
   - ✅ Response times <1s for most requests
   - ✅ No 502 errors
   - ✅ Images load correctly
   - ✅ UI remains responsive

**Expected Results**:
- System handles concurrent load
- Response times acceptable
- No crashes or errors

### 7. Image Download Test

**Objective**: Verify image download works with new endpoint.

**Steps**:
1. Generate an image
2. Click download button
3. Verify:
   - ✅ File downloads correctly
   - ✅ File has correct name format
   - ✅ File opens as valid image

**Expected Results**:
- Downloads work via new endpoint
- File names correct
- Images valid

## Performance Benchmarks

### Before Optimizations (Baseline)
- `/api/images` response: 10s - 449s
- Payload size: 10-50MB+
- Image generation: Blocking, 10-20s, frequent timeouts
- Concurrent users: System struggles with 20 users

### After Optimizations (Target)
- `/api/images` response: <500ms (99% improvement)
- Payload size: <100KB (99% reduction)
- Image generation: Non-blocking, async queue
- Concurrent users: Handles 20+ users smoothly

## Monitoring During Tests

### Server Logs
Watch for:
- Response times in logs
- Error rates
- Database query times
- Memory usage

### Browser DevTools
Monitor:
- Network tab: Response times, payload sizes
- Console: Errors, warnings
- Performance tab: Page load times

### Key Metrics to Track
1. **API Response Times**:
   - `/api/images`: Should be <500ms
   - `/api/images/[id]/image`: Should be <200ms
   - `/api/images/generate`: Should be <1s (returns immediately)

2. **Payload Sizes**:
   - `/api/images`: Should be <100KB
   - Image endpoints: Varies by image size

3. **Error Rates**:
   - Should be <1% under normal load
   - No 502 errors during generation

4. **Concurrent Requests**:
   - Should handle 20+ simultaneous requests
   - No database locks or timeouts

## Troubleshooting

### Issue: Images not loading
- Check `/api/images/[id]/image` endpoint returns 200
- Verify image exists in database
- Check browser console for CORS/network errors

### Issue: Generation stuck on "Pending"
- Check server logs for job queue errors
- Verify OpenRouter API key is set
- Check job status endpoint: `/api/images/generate?submissionId=[id]`

### Issue: Rate limiting too aggressive
- Adjust limits in `src/lib/rate-limit.ts`
- Check if multiple users share same IP

### Issue: Cache not working
- Verify cache is being set (check `X-Cache: MISS` then `HIT`)
- Check cache invalidation is called on updates
- Verify cache TTL settings

### Issue: Slow responses still
- Check database indexes exist
- Verify pagination is working
- Check for N+1 query problems
- Monitor database connection pool

## Regression Tests

Verify existing functionality still works:
- ✅ Student login/logout
- ✅ Image generation
- ✅ Image sharing
- ✅ Liking images
- ✅ Comments
- ✅ Teacher dashboard
- ✅ Chat functionality
- ✅ Session management

## Load Testing Recommendations

For production readiness, consider:
1. Use tools like Apache Bench or k6 for load testing
2. Test with 50+ concurrent users
3. Monitor database performance
4. Check memory usage over time
5. Verify job queue doesn't grow unbounded

## Next Steps After Testing

1. **If all tests pass**: Deploy to production
2. **If issues found**: 
   - Document specific failures
   - Check server logs
   - Review optimization code
   - Fix and retest

3. **Production considerations**:
   - Replace in-memory cache with Redis
   - Replace in-memory job queue with BullMQ/Redis
   - Add monitoring (Sentry, DataDog, etc.)
   - Set up database connection pooling
   - Consider migrating to PostgreSQL for better concurrency

