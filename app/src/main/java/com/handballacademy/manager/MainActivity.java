package com.handballacademy.manager;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.util.Base64;
import android.widget.Toast;
import java.io.OutputStream;
import java.io.IOException;

public class MainActivity extends Activity {
    private static final int CREATE_FILE_REQUEST = 4107;
    private byte[] pendingBytes;
    private String pendingMime = "text/csv";

    private class AndroidFileBridge {
        @JavascriptInterface
        public void saveFile(String filename, String mimeType, String base64Data) {
            try {
                pendingBytes = Base64.decode(base64Data, Base64.DEFAULT);
                pendingMime = (mimeType == null || mimeType.isEmpty()) ? "application/octet-stream" : mimeType;
                runOnUiThread(() -> {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(pendingMime);
                    intent.putExtra(Intent.EXTRA_TITLE, filename == null ? "attendance-report.csv" : filename);
                    try { startActivityForResult(intent, CREATE_FILE_REQUEST); }
                    catch (Exception e) { Toast.makeText(MainActivity.this, "مش قادر أفتح نافذة حفظ الملف", Toast.LENGTH_LONG).show(); }
                });
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "فشل تجهيز التقرير للحفظ", Toast.LENGTH_LONG).show());
            }
        }
    }

    private WebView webView;
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        webView.addJavascriptInterface(new AndroidFileBridge(), "AndroidFileBridge");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == CREATE_FILE_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingBytes != null) {
                Uri uri = data.getData();
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new IOException("Output stream unavailable");
                    out.write(pendingBytes);
                    Toast.makeText(this, "تم حفظ التقرير بنجاح", Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    Toast.makeText(this, "حصل خطأ أثناء حفظ التقرير", Toast.LENGTH_LONG).show();
                }
            }
            pendingBytes = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
