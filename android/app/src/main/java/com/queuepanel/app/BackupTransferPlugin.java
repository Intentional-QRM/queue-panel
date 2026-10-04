package com.queuepanel.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "BackupTransfer")
public class BackupTransferPlugin extends Plugin {
    private static final int MAX_BACKUP_BYTES = 5 * 1024 * 1024;

    @PluginMethod
    public void exportData(PluginCall call) {
        String content = call.getString("content");
        String fileName = call.getString("fileName", "QueuePanel_Backup.json");

        if (content == null || content.getBytes(StandardCharsets.UTF_8).length > MAX_BACKUP_BYTES) {
            call.reject("Invalid backup data");
            return;
        }
        if (!fileName.matches("QueuePanel_Backup_\\d{4}-\\d{2}-\\d{2}(?:_[\\d-]+)?\\.json")) {
            fileName = "QueuePanel_Backup.json";
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "exportResult");
    }

    @ActivityCallback
    private void exportResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        if (activityResult.getResultCode() != Activity.RESULT_OK || activityResult.getData() == null) {
            resolveCanceled(call);
            return;
        }

        Uri uri = activityResult.getData().getData();
        if (uri == null) {
            resolveCanceled(call);
            return;
        }

        String content = call.getString("content");
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null || content == null) throw new IllegalStateException("Unable to open selected document");
            output.write(content.getBytes(StandardCharsets.UTF_8));

            JSObject result = new JSObject();
            result.put("canceled", false);
            result.put("fileName", displayName(uri));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Queue Panel data could not be exported", error);
        }
    }

    @PluginMethod
    public void importData(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        startActivityForResult(call, intent, "importResult");
    }

    @ActivityCallback
    private void importResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        if (activityResult.getResultCode() != Activity.RESULT_OK || activityResult.getData() == null) {
            resolveCanceled(call);
            return;
        }

        Uri uri = activityResult.getData().getData();
        if (uri == null) {
            resolveCanceled(call);
            return;
        }

        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalStateException("Unable to open selected document");

            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_BACKUP_BYTES) throw new IllegalArgumentException("Backup file is too large");
                output.write(buffer, 0, read);
            }

            JSObject result = new JSObject();
            result.put("canceled", false);
            result.put("content", output.toString(StandardCharsets.UTF_8.name()));
            result.put("fileName", displayName(uri));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Queue Panel data could not be imported", error);
        }
    }

    private void resolveCanceled(PluginCall call) {
        JSObject result = new JSObject();
        result.put("canceled", true);
        call.resolve(result);
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) {}
        return "Queue Panel backup";
    }
}
