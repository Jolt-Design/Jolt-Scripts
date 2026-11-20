<?php

/**
 * Put the ACF Pro license option back how it was before acf-prepare-license.php ran.
 *
 * Expects $jolt['original'] (string|false).
 */

$required = ['acf_pro_update_license_option', 'acf_pro_delete_license_option', 'acf_updates'];

foreach ($required as $function) {
    if (!function_exists($function)) {
        echo 'JOLT_RESULT:', json_encode(['status' => 'unavailable']), PHP_EOL;
        return;
    }
}

$original = $jolt['original'] ?? false;

if ($original === false) {
    acf_pro_delete_license_option('acf_pro_license');
} else {
    acf_pro_update_license_option('acf_pro_license', $original);
}

acf_updates()->refresh_plugins_transient();
delete_site_transient('update_plugins');

echo 'JOLT_RESULT:', json_encode(['status' => 'ok']), PHP_EOL;
