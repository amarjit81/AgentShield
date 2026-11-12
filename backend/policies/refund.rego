package agentshield.refund

import rego.v1

# Missing or invalid inputs can never produce an allow decision.
default decision := "BLOCK"

valid_input if {
    input.action == "REFUND"
    input.currency == "INR"
    is_number(input.amount)
    input.amount > 0
    is_number(input.limits.autoApproveLimit)
    is_number(input.limits.maxAllowedRefund)
    input.limits.autoApproveLimit >= 0
    input.limits.maxAllowedRefund > 0
    input.limits.maxAllowedRefund <= 1000000000
    input.limits.autoApproveLimit <= input.limits.maxAllowedRefund
}

decision := "ALLOW" if {
    valid_input
    input.amount <= input.limits.autoApproveLimit
}

decision := "REQUIRE_APPROVAL" if {
    valid_input
    input.amount > input.limits.autoApproveLimit
    input.amount <= input.limits.maxAllowedRefund
}
