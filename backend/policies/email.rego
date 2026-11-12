package agentshield.email

import rego.v1

default decision := "BLOCK"

matches_domain(domains) if {
    some domain in domains
    input.recipientDomain == domain
}

matches_domain(domains) if {
    some domain in domains
    endswith(input.recipientDomain, sprintf(".%s", [domain]))
}

valid_input if {
    input.action == "SEND_EMAIL"
    is_string(input.recipientDomain)
    input.recipientDomain != ""
    is_array(input.settings.internalDomains)
    is_array(input.settings.blockedDomains)
}

decision := "ALLOW" if {
    valid_input
    not matches_domain(input.settings.blockedDomains)
    matches_domain(input.settings.internalDomains)
}

decision := "REQUIRE_APPROVAL" if {
    valid_input
    not matches_domain(input.settings.blockedDomains)
    not matches_domain(input.settings.internalDomains)
}
