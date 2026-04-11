# Test Review Checklist

## For Security Team Review (Authentication & Authorization)

### Technical Correctness
- [ ] Token validation follows JWT best practices
- [ ] Rate limiting thresholds are appropriate for security
- [ ] Error messages don't leak sensitive information
- [ ] Session management is stateless and secure

### Security Validation
- [ ] JWT tokens use strong secret (min 32 chars)
- [ ] Token expiration is set appropriately (7 days max)
- [ ] Rate limiting prevents brute force attacks
- [ ] No token leakage in logs or error responses
- [ ] Cookie attributes are secure (httpOnly, secure, sameSite)

### Threat Modeling
- [ ] Tests cover token theft scenarios
- [ ] Tests cover replay attack prevention
- [ ] Tests cover rate limit bypass attempts
- [ ] Tests cover expired token handling

## For Engineering Review (Code Quality)

### Code Structure
- [ ] Follows established patterns in codebase
- [ ] Uses appropriate abstractions
- [ ] Error handling is consistent
- [ ] No code duplication

### Test Quality
- [ ] Tests follow Arrange-Act-Assert pattern
- [ ] Edge cases are covered
- [ ] Mocking strategy is appropriate
- [ ] No flaky tests (deterministic)

### Performance
- [ ] No performance regressions
- [ ] Memory usage is controlled
- [ ] Test execution time is reasonable

## For Product Review (Business Logic)

### User Scenarios
- [ ] Tests cover all user flows
- [ ] Error states provide helpful messages
- [ ] Edge cases don't break user experience

### Business Rules
- [ ] Subscription states transition correctly
- [ ] Payment failure handling is user-friendly
- [ ] Trial period logic is correct
- [ ] Cancellation flow works as expected

### Compliance
- [ ] PCI-DSS requirements considered
- [ ] Audit trails are maintained
- [ ] Data retention policies followed

## Review Process Checklist

### Pre-Review Preparation
- [ ] All tests pass locally
- [ ] Code coverage meets targets (≥80% for new code)
- [ ] Documentation is updated
- [ ] No linting errors

### During Review
- [ ] Reviewer understands the context
- [ ] All concerns are addressed
- [ ] Trade-offs are documented
- [ ] Security implications are discussed

### Post-Review Actions
- [ ] All feedback is incorporated
- [ ] Tests are updated if needed
- [ ] Deployment plan is documented
- [ ] Rollback procedure is defined

## Quality Gates (Must Pass)

### Security Gates
- [ ] No authentication bypass possible
- [ ] Rate limiting is effective
- [ ] Token validation is strict
- [ ] Error messages are generic

### Functional Gates
- [ ] All test scenarios pass
- [ ] Integration tests with database
- [ ] E2E flows complete successfully
- [ ] Performance within limits

### Operational Gates
- [ ] CI pipeline passes
- [ ] Deployment plan ready
- [ ] Monitoring configured
- [ ] Rollback tested
