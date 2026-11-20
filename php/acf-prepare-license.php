<?php

/**
 * Re-save the ACF Pro license key against the current (WP-CLI) home URL so ACF sends it with update checks, and
 * activate it for that URL if ACF's server doesn't already have it activated there.
 *
 * Expects $jolt['configuredKey'] (string|null). Prints a JOLT_RESULT line with the status, the original option and
 * the activation outcome.
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

$activation = 'not-needed';
$message = null;

if (function_exists('acf_pro_get_license_status') && function_exists('acf_pro_activate_license')) {
    $licenseStatus = acf_pro_get_license_status(true);

    if (($licenseStatus['status'] ?? '') !== 'active') {
        $response = acf_pro_activate_license($key, true);

        if (is_wp_error($response)) {
            $activation = 'failed';
            $message = $response->get_error_message();
        } elseif (!empty($response['success'])) {
            $activation = 'activated';
        } else {
            $activation = 'failed';
            $message = $response['message'] ?? null;
        }
    }
}

acf_updates()->refresh_plugins_transient();
delete_site_transient('update_plugins');

echo 'JOLT_RESULT:', json_encode([
    'status' => 'ok',
    'source' => $configuredKey ? 'config' : 'database',
    'original' => $original,
    'activation' => $activation,
    'message' => $message,
]), PHP_EOL;
