package com.partisan.pcc;

import android.content.Intent;
import android.webkit.CookieManager;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Digiicampus for the app's pages (window.Capacitor.Plugins.Campus):
 *   signIn()  opens the university's sign-in page; resolves { token } or rejects if cancelled
 *   signOut() forgets the sign-in (clears the site's cookies)
 * The data itself is fetched by the page (js/campus.js) with the token.
 */
@CapacitorPlugin(name = "Campus")
public class CampusPlugin extends Plugin {

    @PluginMethod
    public void signIn(PluginCall call) {
        Intent intent = new Intent(getContext(), CampusLoginActivity.class);
        startActivityForResult(call, intent, "signInResult");
    }

    @ActivityCallback
    private void signInResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        String token = data != null ? data.getStringExtra(CampusLoginActivity.EXTRA_TOKEN) : null;
        if (result.getResultCode() == android.app.Activity.RESULT_OK && token != null) {
            JSObject ret = new JSObject();
            ret.put("token", token);
            call.resolve(ret);
        } else {
            call.reject("cancelled");
        }
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        CookieManager.getInstance().removeAllCookies(ok -> {
            CookieManager.getInstance().flush();
            call.resolve();
        });
    }
}
