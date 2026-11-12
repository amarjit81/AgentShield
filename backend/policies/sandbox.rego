package agentshield.sandbox

import rego.v1

default decision := "BLOCK"

valid_input if {
    input.action == "SANDBOX_FILE"
    is_string(input.target)
    count(input.target) <= 240
    regex.match(`^[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*(/[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*)*$`, input.target)
    startswith(input.target, "workspace/")
    not startswith(input.target, "workspace/protected/")
    input.target != "workspace/protected"
}

decision := "ALLOW" if {
    valid_input
    input.operation in {"READ", "WRITE"}
}

decision := "REQUIRE_APPROVAL" if {
    valid_input
    input.operation in {"DELETE", "CHANGE"}
}
