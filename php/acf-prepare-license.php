<?php

/**
 * Re-save the ACF Pro license key against the current (WP-CLI) home URL so ACF sends it with update checks.
 *
 * Expects $jolt['configuredKey'] (string|null). Prints a JOLT_RESULT line with the status and the original option.
 */

$required = ['acf_pro_get_license_option', 'acf_pro_get_license_key', 'acf_pro_update_license', 'acf_updates'];

foreach ($required as $function) {
    if (!function_exists($function)) {
        echo 'JOLT_RESULT:', json_encode(['status' => 'unavailable']), PHP_EOL;
        return;
    }
}

$configuredKey = $jolt['configuredKey'] ?? null;
$original = acf_pro_get_license_option('acf_pro_license', false);
$key = $configuredKey ?: acf_pro_get_license_key(true);

if (!$key) {
    echo 'JOLT_RESULT:', json_encode(['status' => 'no-key']), PHP_EOL;
    return;
}

acf_pro_update_license($key);
acf_updates()->refresh_plugins_transient();
delete_site_transient('update_plugins');

echo 'JOLT_RESULT:', json_encode([
    'status' => 'ok',
    'source' => $configuredKey ? 'config' : 'database',
    'original' => $original,
]), PHP_EOL;
