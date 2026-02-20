/**
 * Validation script for standard-login skill.
 * 
 * This script runs BEFORE the agent is allowed to execute the skill instructions.
 * It verifies that the necessary environment variables are present.
 * 
 * Returns:
 * - true: Validation passed
 * - false: Validation failed (skill execution will be blocked)
 */

export default async function validate(): Promise<{ valid: boolean; error?: string }> {
  console.log("[Tripwire] Validating standard-login prerequisites...");

  if (!process.env.TEST_USER) {
    console.error("[Tripwire] FAILED: TEST_USER environment variable is missing.");
    return { valid: false, error: "TEST_USER environment variable is missing." };
  }

  if (!process.env.TEST_USER_PASSWORD) {
    console.error("[Tripwire] FAILED: TEST_USER_PASSWORD environment variable is missing.");
    return { valid: false, error: "TEST_USER_PASSWORD environment variable is missing." };
  }

  console.log("[Tripwire] Validation passed for standard-login.");
  return { valid: true };
}
