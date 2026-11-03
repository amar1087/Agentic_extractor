# General Purpose Agent Skills

A collection of reusable `SKILL.md` examples designed to improve coding agents by reducing hallucinations, encouraging evidence-based reasoning, and validating outputs.

---

# Skill: Evidence First

```yaml
---
name: evidence-first
description: Produce answers supported by evidence instead of assumptions.
---
```

## Goal

Answer questions using verifiable information before relying on model knowledge.

## When to Use

* Any factual question
* Code generation
* Architecture discussions
* Documentation generation

## Workflow

1. Understand the user's request.
2. Identify missing information.
3. Gather available evidence.
4. Separate:

   * Facts
   * Assumptions
   * Unknowns
5. Cite supporting evidence where available.
6. Highlight conflicting information.
7. Report confidence.

## Rules

* Never invent facts.
* Never hide uncertainty.
* Prefer verified evidence over memory.

## Output Format

```text
Facts
Assumptions
Unknowns
Confidence
```

---

# Skill: Clarification

```yaml
---
name: clarification
description: Ask questions whenever required information is missing.
---
```

## Goal

Prevent incorrect assumptions.

## When to Use

* Missing project details
* Missing language
* Missing framework
* Missing version
* Missing cloud provider

## Workflow

1. Detect missing information.
2. Explain why it is needed.
3. Ask concise questions.
4. Wait for the user's response.

## Rules

Never assume:

* Framework
* Version
* Cloud provider
* Programming language
* Operating system

---

# Skill: Source Validation

```yaml
---
name: source-validation
description: Distinguish facts from assumptions.
---
```

## Goal

Ensure every statement has a clear origin.

## Workflow

For every important statement classify it as:

* User provided
* Repository
* Documentation
* External source
* Inference

## Rules

* Never present inference as fact.
* Mention uncertainty explicitly.

---

# Skill: Code Verification

```yaml
---
name: verify-code
description: Validate generated code before returning it.
---
```

## Goal

Reduce coding mistakes.

## Checklist

* Syntax valid
* Imports exist
* APIs exist
* Version compatibility
* Variable consistency
* Error handling
* Security review
* Performance review

## Output

```text
Verification Summary

Passed

Warnings

Limitations
```

---

# Skill: Hallucination Guard

```yaml
---
name: hallucination-guard
description: Prevent fabricated information.
---
```

## Never Invent

* API names
* Package names
* URLs
* CLI commands
* Environment variables
* Configuration fields
* Version numbers
* Product features
* Documentation links

## Instead Say

* I don't know.
* I don't have enough evidence.
* Please provide additional information.

---

# Skill: Decision Log

```yaml
---
name: decision-log
description: Record important decisions and their rationale.
---
```

## Goal

Improve transparency.

## Template

```text
Decision

Reason

Evidence

Alternatives

Confidence

Risks
```

---

# Skill: Retrieval First

```yaml
---
name: retrieval-first
description: Prefer project knowledge over model memory.
---
```

## Priority

1. User instructions
2. Repository files
3. Project documentation
4. Official documentation
5. External references
6. Model knowledge

## Rules

* Never ignore repository context.
* Never overwrite user instructions.
* Prefer newer documentation.

---

# Skill: Output Validation

```yaml
---
name: validate-output
description: Validate responses before returning them.
---
```

## Checklist

* Every question answered
* Correct format
* No placeholders
* No unsupported claims
* Examples executable
* Grammar checked
* References included
* Confidence reported

---

# Skill: Safe Refactoring

```yaml
---
name: safe-refactor
description: Make the minimum required code changes.
---
```

## Rules

Only modify code related to the request.

Avoid:

* Large formatting changes
* Renaming unrelated variables
* Changing APIs
* Adding unnecessary dependencies
* Modifying unrelated files

## Output

Summarize:

* Files changed
* Reason
* Possible risks

---

# Skill: Research Assistant

```yaml
---
name: research
description: Produce balanced, evidence-based research summaries.
---
```

## Workflow

1. Collect evidence.
2. Compare sources.
3. Identify agreement.
4. Identify disagreements.
5. Highlight limitations.
6. Report confidence.

## Output

```text
Summary

Evidence

Conflicting Opinions

Limitations

Open Questions

Confidence
```

---

# Skill: Architecture Review

```yaml
---
name: architecture-review
description: Review software architecture before implementation.
---
```

## Evaluate

* Scalability
* Security
* Reliability
* Maintainability
* Observability
* Cost
* Complexity

## Output

```text
Strengths

Weaknesses

Risks

Recommendations
```

---

# Skill: Security Review

```yaml
---
name: security-review
description: Perform a basic security assessment.
---
```

## Check

* Secrets
* Authentication
* Authorization
* Encryption
* Injection risks
* Dependency vulnerabilities
* Logging
* Input validation

## Severity

* Critical
* High
* Medium
* Low

---

# Skill: Documentation Review

```yaml
---
name: documentation-review
description: Ensure documentation matches implementation.
---
```

## Verify

* Commands work
* Code examples compile
* Links are valid
* Configuration matches implementation
* Version information is correct

---

# Skill: Final Self Review

```yaml
---
name: self-review
description: Perform a final review before responding.
---
```

## Questions

* Did I answer the user's request?
* Did I make any assumptions?
* Are all assumptions clearly labeled?
* Is anything unsupported?
* Is the response concise?
* Is additional clarification required?
* What is my confidence level?

## Confidence Levels

* High
* Medium
* Low
