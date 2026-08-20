# /release

⚑ **This file is Zach's directive, verbatim, and nothing else.** He asked for it to
contain only the text below. Do not paraphrase it, do not summarise it away, do not
"tidy" it into bullets, and never let any part of it be dropped — a standing
directive in an earlier version of this file was lost once and had to be given
twice. If it needs to change, Zach changes it.

Operational lore (gate rules, shared-checkout hazards, Firestore/Stripe/jest traps,
deploy verification) is NOT repeated here on purpose — it lives in `MEMORY.md`, which
loads every session. Read that first, then do what this file says.

---

I put everything that is urgent and launch blocking in to todo, we only need to focus
on the todo list. No more creating issues, if something arises fix it under the same
issue and same commit. Getting things ready to release on Sept 1, spawning each one in
a new background agent, completing as many as possible at once, updating linear as we
go, especially status from todo to in progress to done or in review. We need to make
sure the free/hobby tier does hard cap so it always actually stays free.. We gotta get
these things ready to go and be released to the public and start accepting payments,
selling marketplace items, and the storefronts of the hosts ready to receive payments
and fulfill orders and shipments etc, all of the commerce features and addons and
plugins, and our subscription tiers, our usage metering. We need to make sure we are
not losing money when we release and will enable features that will not produce churn
but rather commitment. Don't forget you can use my browser to test and use my
authentication session, but first try using the local dev environment or emulator
environment, you can use my browser to manage anything such as stripe, google cloud,
firebase, aglyn, vercel etc, also when looking for env always double check
shared/global envs. Don't forget we always need to keep the docs in sync and create new
pages and reorganize as necessary, take screenshots of the browser and make as
visualized as possible, you also don't always need screenshot the entire page but can
screenshot sections of the site of components, maybe even add outlines and text, or
annotations if need to better visualize and make the image more descriptive or helpful.
Also add helpful how-to guides and walk through guides and make it easy for anybody but
also very descriptive for those who are also technical and need reference guides where
necessary etc, also make sure we are updating the tooltip documentation tips across
Aglyn. If you need something from me, then ask me a question and give me options.

Fix all of the dependabot alerts and prs etc. Also build numerous reports for us in GA,
and it can use my browser to do it. Also Add a new console ai generative chat bot
helper tool persisted on every page to assist with direction or how to do things,
direct them to documentation or help them use aglyn or to automate current view etc
create a new element or change the screen design or build page content or build an
entire site for them or update attribute value in besigner etc, the expanse of this
tool can be entirely up to you, remember we need to make it easy for all 3 of our ICPs,
Multi-Site orgs, agencies, and beginner mom and pop or fresh business looking to get
started etc. We need to make sure it is easy for someone who doesn't know code and even
easier for someone who does know code. We may need to make this a paid feature to keep
from costing us too much money and keep our profit margins high, provide all
limitations to possibly make a free version available. We will also want to use the
data and questions and answers to help better build our docs so we will need to store
that info and allow us to learn from it to improve docs and the ai tool. Always make
sure features are available in the console and not just that the capability exists,
nothing should be like that anyways, if there are any features that are the capability
exists but they are not implemented in the UI of the console or where appropriate then
we need to add them now. If you need to access google accounts like admin or drive or
whatever, zach@aglyn.com is not the primary google account in the browser, you will
need to append the u/4 to the address bar or use the account switcher to use
zach@aglyn.com if you need it. We need to be committing directly to main, go ahead and
push immediately, we should not be using other branches. Batch the promotions to
production so we don't hit our free vercel deployment limit, and auto merge them for me
with a merge commit. Don't gate them just yet. Release on September 1, please make sure
we meet that deadline. We also need to make sure we have an issue reporting tool inside
the console available for people to file bug reports etc, then have it tracked in a
separate linear project then our primary one.
