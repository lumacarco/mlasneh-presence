<?php
declare(strict_types=1);

function send_presence(array $payload): bool
{
    $baseUrl = rtrim((string)getenv('PRESENCE_URL'), '/');
    $secret = (string)getenv('PRESENCE_SECRET');

    if ($baseUrl === '' || $secret === '') {
        return false;
    }

    $body = json_encode(
        $payload,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );

    if ($body === false) {
        return false;
    }

    $timestamp = (string)round(microtime(true) * 1000);

    $signature = hash_hmac(
        'sha256',
        $timestamp . '.' . $body,
        $secret
    );

    $ch = curl_init($baseUrl . '/presence');

    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-SNEH-Timestamp: ' . $timestamp,
            'X-SNEH-Signature: ' . $signature,
        ],
    ]);

    curl_exec($ch);

    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);

    curl_close($ch);

    return $status >= 200 && $status < 300;
}
