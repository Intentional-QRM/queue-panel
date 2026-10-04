package com.queuepanel.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackupTransferPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
