package com.partisan.pcc;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Properties;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.mail.Address;
import javax.mail.AuthenticationFailedException;
import javax.mail.FetchProfile;
import javax.mail.Folder;
import javax.mail.Message;
import javax.mail.Session;
import javax.mail.Store;
import javax.mail.UIDFolder;
import javax.mail.internet.InternetAddress;
import javax.mail.search.ComparisonTerm;
import javax.mail.search.ReceivedDateTerm;

/**
 * Mail for the app's pages (window.Capacitor.Plugins.Mail), read-only, the
 * same way as PCC on the computer: Gmail's IMAP with an app password (not the
 * account's normal password). The app password is encrypted with a key kept
 * in Android's keystore and never leaves the phone.
 *   save({ email, password })          store the sign-in (password encrypted)
 *   status()                           -> { email, configured }
 *   fetch({ daysBack, limit })         -> { messages: [...] } newest first, or rejects with a readable reason
 *   forget()                           remove the sign-in
 *   open({ messageId })                show a message in Gmail
 */
@CapacitorPlugin(name = "Mail")
public class MailPlugin extends Plugin {
    private static final String PREFS = "pcc-mail";
    private static final String KEY_ALIAS = "pcc-mail-password";
    private static final int DIRECT_MAX_RECIPIENTS = 5;   // as on the computer: more than this is a group mail

    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    @PluginMethod
    public void save(PluginCall call) {
        String email = call.getString("email", "").trim();
        String password = call.getString("password", "").replaceAll("\\s+", "");
        if (email.isEmpty() || password.isEmpty()) { call.reject("Enter your email and the app password."); return; }
        try {
            prefs().edit().putString("email", email).putString("secret", encrypt(password)).apply();
            call.resolve(statusObj());
        } catch (Exception e) { call.reject("Couldn't store the password safely on this phone."); }
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(statusObj()); }

    private JSObject statusObj() {
        JSObject o = new JSObject();
        o.put("email", prefs().getString("email", ""));
        o.put("configured", prefs().contains("secret"));
        return o;
    }

    @PluginMethod
    public void forget(PluginCall call) {
        prefs().edit().clear().apply();
        call.resolve();
    }

    @PluginMethod
    public void open(PluginCall call) {
        String id = call.getString("messageId", "").replaceAll("^<|>$", "");
        String email = prefs().getString("email", "");
        String url = "https://mail.google.com/mail/u/" + Uri.encode(email) + "/#search/rfc822msgid%3A" + Uri.encode(id);
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void fetch(PluginCall call) {
        final int days = call.getInt("daysBack", 14);
        final int limit = call.getInt("limit", 60);
        new Thread(() -> {
            Store store = null;
            try {
                String email = prefs().getString("email", "");
                String secret = prefs().getString("secret", null);
                if (email.isEmpty() || secret == null) { call.reject("Mail isn't set up yet."); return; }
                Properties props = new Properties();
                props.put("mail.store.protocol", "imaps");
                props.put("mail.imaps.connectiontimeout", "15000");
                props.put("mail.imaps.timeout", "20000");
                store = Session.getInstance(props).getStore("imaps");
                store.connect("imap.gmail.com", 993, email, decrypt(secret));
                Folder inbox = store.getFolder("INBOX");
                inbox.open(Folder.READ_ONLY);   // read-only: nothing is marked, moved or deleted
                Date since = new Date(System.currentTimeMillis() - days * 86400000L);
                Message[] found = inbox.search(new ReceivedDateTerm(ComparisonTerm.GE, since));
                List<Message> list = new ArrayList<>();
                Collections.addAll(list, found);
                Collections.reverse(list);
                if (list.size() > limit) list = list.subList(0, limit);
                Message[] batch = list.toArray(new Message[0]);
                FetchProfile fp = new FetchProfile();
                fp.add(FetchProfile.Item.ENVELOPE);
                fp.add(UIDFolder.FetchProfileItem.UID);
                fp.add(FetchProfile.Item.FLAGS);   // read or not, as Gmail has it (only looked at, never changed)
                fp.add("List-Id"); fp.add("List-Unsubscribe"); fp.add("Precedence"); fp.add("Message-ID");
                inbox.fetch(batch, fp);
                String me = sameInbox(email);
                JSArray out = new JSArray();
                for (Message m : batch) {
                    JSObject o = new JSObject();
                    o.put("key", ((UIDFolder) inbox).getUIDValidity() + ":" + ((UIDFolder) inbox).getUID(m));
                    o.put("subject", m.getSubject() == null ? "(no subject)" : m.getSubject());
                    Address[] from = m.getFrom();
                    if (from != null && from.length > 0 && from[0] instanceof InternetAddress) {
                        InternetAddress f = (InternetAddress) from[0];
                        o.put("fromName", f.getPersonal() == null ? "" : f.getPersonal());
                        o.put("fromAddress", f.getAddress() == null ? "" : f.getAddress());
                    }
                    Date d = m.getReceivedDate() != null ? m.getReceivedDate() : m.getSentDate();
                    o.put("date", d == null ? 0 : d.getTime());
                    String[] mid = m.getHeader("Message-ID");
                    o.put("messageId", mid != null && mid.length > 0 ? mid[0] : "");
                    o.put("audience", audience(m, me));
                    o.put("seen", m.isSet(javax.mail.Flags.Flag.SEEN));
                    out.put(o);
                }
                inbox.close(false);
                JSObject ret = new JSObject();
                ret.put("messages", out);
                call.resolve(ret);
            } catch (AuthenticationFailedException e) {
                call.reject("Gmail didn't accept the sign-in. Check the email, and that it's an app password (16 letters), not your normal password.");
            } catch (Exception e) {
                call.reject("Couldn't reach your mail. Check your connection and try again.");
            } finally {
                try { if (store != null) store.close(); } catch (Exception ignored) { }
            }
        }).start();
    }

    // Who a message was addressed to: 'direct', 'cc', 'group' or 'list' (as on the computer, main.js mailAudience).
    private static String audience(Message m, String me) throws Exception {
        boolean fromList = m.getHeader("List-Id") != null || m.getHeader("List-Unsubscribe") != null;
        String[] prec = m.getHeader("Precedence");
        if (prec != null && prec.length > 0 && prec[0].toLowerCase().matches("\\s*(bulk|list).*")) fromList = true;
        if (me.isEmpty() || fromList) return "list";
        List<String> to = addresses(m.getRecipients(Message.RecipientType.TO));
        List<String> cc = addresses(m.getRecipients(Message.RecipientType.CC));
        if (to.contains(me)) return to.size() + cc.size() <= DIRECT_MAX_RECIPIENTS ? "direct" : "group";
        if (cc.contains(me)) return "cc";
        return "list";
    }

    private static List<String> addresses(Address[] list) {
        List<String> out = new ArrayList<>();
        if (list != null) for (Address a : list) if (a instanceof InternetAddress) out.add(sameInbox(((InternetAddress) a).getAddress()));
        return out;
    }

    // One person's inbox however the address is written (dots and +tags in Gmail).
    private static String sameInbox(String address) {
        String[] p = String.valueOf(address == null ? "" : address).toLowerCase().trim().split("@");
        if (p.length != 2) return "";
        String local = p[0].split("\\+")[0], domain = p[1];
        if (domain.equals("googlemail.com")) domain = "gmail.com";
        if (domain.equals("gmail.com")) local = local.replace(".", "");
        return local + "@" + domain;
    }

    /* ----- The app password, encrypted with a keystore key ----- */
    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return kg.generateKey();
    }
    private static String encrypt(String text) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = c.getIV(), body = c.doFinal(text.getBytes(StandardCharsets.UTF_8));
        byte[] out = new byte[iv.length + body.length];
        System.arraycopy(iv, 0, out, 0, iv.length); System.arraycopy(body, 0, out, iv.length, body.length);
        return Base64.encodeToString(out, Base64.NO_WRAP);
    }
    private static String decrypt(String stored) throws Exception {
        byte[] raw = Base64.decode(stored, Base64.NO_WRAP);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, raw, 0, 12));
        return new String(c.doFinal(raw, 12, raw.length - 12), StandardCharsets.UTF_8);
    }
}
