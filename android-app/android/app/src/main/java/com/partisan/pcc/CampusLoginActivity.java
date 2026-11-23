package com.partisan.pcc;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.net.URLDecoder;

/**
 * Digiicampus sign-in, on the university's own page. PCC never sees the
 * password: after sign-in the site stores a session token in a cookie named
 * "user", and this screen hands that token back to the app and closes.
 * (The same approach as PCC on the computer; see campus.js there.)
 *
 * The site signs in with Google in a pop-up window that reports back to the
 * page that opened it, so pop-ups open here as a second view on top of the
 * page, and close again when Google is done.
 */
public class CampusLoginActivity extends Activity {
    static final String ORIGIN = "https://nls.digiicampus.com";
    static final String EXTRA_TOKEN = "token";

    private WebView web;
    private WebView popup;            // Google's sign-in window, while it's open
    private FrameLayout pages;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean finished = false;

    // Look for the token cookie every second while the page is open.
    private final Runnable check = new Runnable() {
        @Override public void run() {
            if (finished) return;
            String token = readToken();
            if (token != null) { done(token); return; }
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#0D0D0F"));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0D0D0F"));

        // A slim bar: what this is, and a way out.
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        int pad = (int) (14 * getResources().getDisplayMetrics().density);
        bar.setPadding(pad, pad, pad / 2, pad);
        TextView title = new TextView(this);
        title.setText("Sign in to Digiicampus");
        title.setTextColor(Color.parseColor("#F3F2EE"));
        title.setTextSize(16);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button close = new Button(this);
        close.setText("Cancel");
        close.setAllCaps(false);
        close.setTextColor(Color.parseColor("#C9F26C"));
        close.setBackgroundColor(Color.TRANSPARENT);
        close.setOnClickListener(v -> { finished = true; setResult(RESULT_CANCELED); finish(); });
        bar.addView(close);
        root.addView(bar);

        pages = new FrameLayout(this);
        web = makeWebView();
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                String token = readToken();
                if (token != null) done(token);
            }
        });
        pages.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(pages, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);

        web.loadUrl(ORIGIN + "/");
        handler.postDelayed(check, 1500);
    }

    /** A WebView set up like a phone browser: scripts, storage, cookies, and pop-ups opening on top. */
    private WebView makeWebView() {
        WebView view = new WebView(this);
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        // Without the WebView marker in its name, sign-in pages treat it like the phone's browser.
        s.setUserAgentString(s.getUserAgentString().replace("; wv", ""));
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(view, true);
        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView opener, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                closePopup();
                popup = makeWebView();
                popup.setWebViewClient(new WebViewClient());
                pages.addView(popup, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }

            @Override
            public void onCloseWindow(WebView window) {
                if (window == popup) closePopup();
            }
        });
        return view;
    }

    private void closePopup() {
        if (popup == null) return;
        pages.removeView(popup);
        popup.destroy();
        popup = null;
    }

    /** The token from the "user" cookie, if it's there and looks like one (a JWT: three parts). */
    private String readToken() {
        String all = CookieManager.getInstance().getCookie(ORIGIN);
        if (all == null) return null;
        for (String part : all.split(";")) {
            String p = part.trim();
            if (!p.startsWith("user=")) continue;
            try {
                String token = URLDecoder.decode(p.substring(5), "UTF-8");
                if (token.split("\\.").length == 3) return token;
            } catch (Exception ignored) { }
        }
        return null;
    }

    private void done(String token) {
        if (finished) return;
        finished = true;
        CookieManager.getInstance().flush();
        Intent result = new Intent();
        result.putExtra(EXTRA_TOKEN, token);
        setResult(RESULT_OK, result);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (popup != null) { if (popup.canGoBack()) popup.goBack(); else closePopup(); }
        else if (web != null && web.canGoBack()) web.goBack();
        else { finished = true; setResult(RESULT_CANCELED); super.onBackPressed(); }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(check);
        closePopup();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
