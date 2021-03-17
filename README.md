# Moesif Chargebee Example

An example app integrating Moesif with Chargebee for usage-based billing based [Tutorial to Set Up Usage-Based API Billing with Moesif and Chargebee](https://www.moesif.com/blog/developer-platforms/chargebee/Tutorial-to-Set-Up-Usage-Based-API-Billing-with-Moesif-and-Chargebee/)

* [Moesif](https://www.moesif.com/solutions/metered-api-billing) handles API metering and providing usage metrics to customers
* [Chargebee](https://www.chargebee.com/) handles invoicing customers and accepting payments through a gateway like Stripe.

![Embedded billing dashboard](https://blog.moesif.com/images/posts/developer-experience/embedded-billing-dashboard.svg)

This example app does a few things:
1. Sync Chargebee Subscription info to Moesif
2. Handle metered billing webhooks of type pending_invoice_created
3. Calculate the usage by querying Moesif's Management API
4. Add a line-item charged based on API usage for that customer

## How to run this example.

1. Install all dependencies: 

```bash
npm install
```

2. Set the following environment variables

|Environment variable|Description|
|--------------------|-----------|
|CHARGEBEE_SITE|The slug of your Chargebee site which is the subdomain when logging into your dashboard.|
|CHARGEBEE_API_KEY|A Chargebee API key that has at least read access to both subscriptions and customers.|
|CHARGEBEE_WEBHOOK_USERNAME|The username you define when creating a new webhook in Chargebee|
|CHARGEBEE_WEBHOOK_PASSWORD|The password you define when creating a new webhook in Chargebee|
|MOESIF_APPLICATION_ID|Your Moesif Application Id displayed during onboarding and found under the API keys menu in Moesif|
|MOESIF_MANAGEMENT_API_KEY|A generated management API key which has the scope `read:events` which can be found under the API keys menu in Moesif|

3. Run the example, it will listen on port 5000.

```bash
node index.js
```

4. Verify the app works:
   
* Your Chargebee users and companies will be synced to your Moesif app
* Set up a Chargebee webhook to the app's endpoint `POST /chargebee/webhooks`
  