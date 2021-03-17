const chargebee = require('chargebee');
const cron = require('cron');
const basicAuth = require('express-basic-auth');
const bodyParser = require('body-parser');
const express = require('express');
const safeGet = require('lodash/get');
const superagent = require('superagent');
const moesifapi = require('moesifapi');
const moment = require('moment');

// Initialize SDKs
chargebee.configure({ site: process.env.CHARGEBEE_SITE, api_key: process.env.CHARGEBEE_API_KEY });

moesifapi.configuration.ApplicationId = process.env.MOESIF_APPLICATION_ID;

const app = express();
chargebee.configure({ site: process.env.CHARGEBEE_SITE, api_key: process.env.CHARGEBEE_API_KEY });

app.use(
  basicAuth({
    users: { [process.env.CHARGEBEE_WEBHOOK_USERNAME]: process.env.CHARGEBEE_WEBHOOK_PASSWORD },
  })
);

/****************************************************
 * Part A: Sync Chargebee Subscription info to Moesif
 * https://www.moesif.com/blog/developer-platforms/chargebee/Tutorial-to-Set-Up-Usage-Based-API-Billing-with-Moesif-and-Chargebee/#2-sync-chargebee-subscription-info-to-moesif
 ****************************************************/
const CronJob = cron.CronJob;
new CronJob('*/10 * * * *', function() {
  try {
    console.log('Run syncSubscriptions');
    syncSubscriptions();
  } catch (err) {
    console.log(err);
  }
}, null, true, 'America/Los_Angeles', null, true);

function syncSubscriptions() {
    chargebee.subscription
    // We only need to sync subscriptions that have been updated in the last 24 hrs. 
    .list({
        limit: 100,
        'sort_by[asc]': 'updated_at',
        'updated_at[after]': moment().utc().subtract(24, 'hour').unix(),
    })
    .request()
    .then((subscriptions) => {

            console.log(`Received subscriptions`)

            // Save Chargebee subscriptions as Moesif companies
            const companies = subscriptions.list.map((s) => {
                return {
                    company_id: s.subscription.id,
                    metadata: s.subscription // Rest of metadata
                }
            })

           // console.log(JSON.stringify(companies));
            moesifapi.ApiController.updateCompaniesBatch(companies, (error, response, context) => {
                if (error) {
                    console.log(error) 
                } else {
                    console.log(`Synced Chargebee Subscriptions to Moesif Companies Successfully statusCode=${context.response.statusCode}`)
                }

                // Save Chargebee customers and contacts as Moesif users
                const users = subscriptions.list.map((s) => {
                    const contacts = s.customer.contacts ? 
                        contacts.map(c => {
                            return {
                                user_id: c.id,
                                company_id: s.subscription.id,
                                email: c.email,
                                first_name: c.first_name,
                                last_name: c.last_name,
                                metadata: { label: c.label, ...s.customer } // Rest of metadata
                            };
                        }) : [];

                    return [
                        ...contacts, 
                        {
                            user_id: s.customer.id,
                            company_id: s.subscription.id,
                            email: s.customer.email,
                            first_name: s.customer.first_name,
                            last_name: s.customer.last_name,
                            metadata: s.customer // Rest of metadata
                        }
                    ];

                });

                usersFlattened = users.reduce(function(a, b){
                    return a.concat(b);
               }, []);

                moesifapi.ApiController.updateUsersBatch(usersFlattened, (error, response, context) => { 
                    if (error) {
                        console.log(error) 
                    } else {
                        console.log(`Synced Chargebee Subscriptions to Moesif Users Successfully statusCode=${context.response.statusCode}`)
                    }
                });
            });
        }
    );
}

/*****************************************
 * Part B: Handle metered billing webhooks
 * https://www.moesif.com/blog/developer-platforms/chargebee/Tutorial-to-Set-Up-Usage-Based-API-Billing-with-Moesif-and-Chargebee/#3-handle-metered-billing-webhooks
******************************************/
const UNIT_COST_IN_CENTS = 1; // How much each transaction is worth in cents

// Simple sample query which can be found going to "Events" -> "Segmentation" in Moesif.
// Then select the orange Get Via API button under "Embed".
function getCompanyUsageQuery(companyId) {
    return {
        aggs: {
            seg: {
                filter: {
                    bool: {
                        must: [
                            {
                                terms: {
                                    'request.route.raw': [
                                        '/purchases',
                                        '/withdraws',
                                        '/'
                                    ]
                                }
                            },
                            {
                                term: {
                                    'company_id.raw': companyId
                                }
                            }
                        ]
                    }
                },
                aggs: {
                    weight: {
                        sum: {
                            field: 'weight',
                            missing: 1
                        }
                    }
                }
            }
        },
        size: 0
    }
}

app.use(bodyParser.json());
app.post('/chargebee/webhooks', (req, res) => {
    const event = req.body;
  
    if (event && event.event_type === 'pending_invoice_created') {

        const invoice = event.content.invoice;

        // Retrieve subscription for this invoice to get billing period
        return chargebee.subscription
            .retrieve(invoice.subscription_id)
            .request()
            .then((subscriptionResult) => {
                const subscription = subscriptionResult.subscription;
                console.log('Retrieved subscription');
                console.log(JSON.stringify(subscription));

                // We should query metric the previous billing period.
                const params = {
                    from: (moment.unix(subscription.current_term_start)
                        .subtract(parseInt(subscription.billing_period), `${subscription.billing_period_unit}s`)).toISOString(),

                    to: moment.unix(subscription.current_term_start).toISOString()
                };

                console.log('Params: ' + moment.unix(subscription.current_term_start).toISOString());
                console.log(JSON.stringify(params));

                // Get usage from Moesif
                return superagent
                    .post(`https://api.moesif.com/v1/search/~/search/events`)
                    .set('Authorization', `Bearer ${process.env.MOESIF_MANAGEMENT_API_KEY}`)
                    .set('Content-Type', 'application/json')
                    .set('accept', 'json')
                    .query(params)
                    .send(getCompanyUsageQuery(subscription.id))
                    .then((countResult) => {

                        const count = safeGet(countResult, 'body.aggregations.seg.weight.value');

                        console.log(`Received count of ${count}`)
                        const amount = count * (UNIT_COST_IN_CENTS); // How much each transaction is worth in cents

                        console.log(`Adding cost for subscription=${subscription.id} of ${amount}`);

                        chargebee.invoice.add_charge(invoice.id,{
                            amount : amount,
                            description : `Usage of ${amount} widgets`
                        }).request(function(error, chargeResult) {
                            if(error){
                                //handle error
                                console.log(JSON.stringify(event));
                                console.log(error);
                                res.status(500).json({ status: 'internal server error' });
                            } else {
                                console.log(chargeResult);
                                res.status(201).json({ status: 'ok ' });
                            }
                        });
                    })
                    .catch((error) => {
                        console.log(error.text);
                        res.status(500).json({ status: 'internal server error' });
                    });
            })
    } 
    console.log(JSON.stringify(event));
    res.status(500).json({ status: 'internal server error' });
});

app.listen(process.env.PORT || 5000, function() {
    console.log('moesif-chargebee-example is listening on port ' + (process.env.PORT || 5000));
});
