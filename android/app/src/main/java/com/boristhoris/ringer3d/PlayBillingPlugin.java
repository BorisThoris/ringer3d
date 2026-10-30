package com.boristhoris.ringer3d;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;
import java.util.List;

/**
 * Google Play Billing for coin packs, seen from the game as PlayBilling (src/platformStore.ts).
 * The phone only buys: the purchase token goes to our server, which checks it with Google and
 * consumes it (server/playStore.mjs). Anything paid but not consumed is listed by unconsumed().
 */
@CapacitorPlugin(name = "PlayBilling")
public class PlayBillingPlugin extends Plugin {
    private BillingClient client;
    /** The purchase() call waiting for Google's purchase sheet to close. */
    private PluginCall pending;
    private String pendingProduct;

    @Override
    public void load() {
        client = BillingClient.newBuilder(getContext())
            .setListener(this::onPurchasesUpdated)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build();
    }

    private interface Ready {
        void run();
    }

    private void connected(PluginCall call, Ready then) {
        if (client.isReady()) {
            then.run();
            return;
        }
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult r) {
                if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) then.run();
                else call.reject("Google Play is unavailable: " + r.getDebugMessage(), "unavailable");
            }

            @Override
            public void onBillingServiceDisconnected() {
                // The next call reconnects.
            }
        });
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        String productId = call.getString("productId");
        if (productId == null) {
            call.reject("productId is required");
            return;
        }
        if (pending != null) {
            call.reject("A purchase is already open", "busy");
            return;
        }
        connected(call, () -> {
            QueryProductDetailsParams q = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()))
                .build();
            client.queryProductDetailsAsync(q, (r, result) -> {
                List<ProductDetails> details = result.getProductDetailsList();
                if (r.getResponseCode() != BillingClient.BillingResponseCode.OK || details.isEmpty()) {
                    call.reject("No such product in the Play Console: " + productId, "unknown");
                    return;
                }
                ProductDetails pd = details.get(0);
                BillingFlowParams flow = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(Collections.singletonList(
                        BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd).build()))
                    .build();
                pending = call;
                pendingProduct = productId;
                call.setKeepAlive(true);
                getActivity().runOnUiThread(() -> {
                    BillingResult launched = client.launchBillingFlow(getActivity(), flow);
                    if (launched.getResponseCode() != BillingClient.BillingResponseCode.OK) finish(launched, null);
                });
            });
        });
    }

    private void onPurchasesUpdated(BillingResult r, List<Purchase> purchases) {
        finish(r, purchases);
    }

    private void finish(BillingResult r, List<Purchase> purchases) {
        PluginCall call = pending;
        String productId = pendingProduct;
        pending = null;
        pendingProduct = null;
        if (call == null) return; // a purchase finishing after the app restarted: unconsumed() finds it
        call.setKeepAlive(false);
        int code = r.getResponseCode();
        if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            call.reject("Cancelled", "cancelled");
            return;
        }
        if (code != BillingClient.BillingResponseCode.OK || purchases == null) {
            call.reject("Purchase failed: " + r.getDebugMessage(), code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED ? "owned" : "failed");
            return;
        }
        for (Purchase p : purchases) {
            if (!p.getProducts().contains(productId)) continue;
            JSObject out = new JSObject();
            out.put("purchaseToken", p.getPurchaseToken());
            out.put("state", p.getPurchaseState() == Purchase.PurchaseState.PURCHASED ? "purchased" : "pending");
            call.resolve(out);
            return;
        }
        call.reject("Google returned no purchase for " + productId, "failed");
    }

    @PluginMethod
    public void unconsumed(PluginCall call) {
        connected(call, () -> client.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
            (r, purchases) -> {
                JSArray list = new JSArray();
                if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    for (Purchase p : purchases) {
                        if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
                        for (String id : p.getProducts()) {
                            JSObject o = new JSObject();
                            o.put("productId", id);
                            o.put("purchaseToken", p.getPurchaseToken());
                            list.put(o);
                        }
                    }
                }
                JSObject out = new JSObject();
                out.put("purchases", list);
                call.resolve(out);
            }));
    }
}
