// @ts-types="npm:@types/oauth"
import { OAuth } from "npm:oauth";

const REQUEST_TOKEN_URL = "https://api.twitter.com/oauth/request_token";
const ACCESS_TOKEN_URL = "https://api.twitter.com/oauth/access_token";

const X_API_KEY = Deno.env.get("X_API_KEY");
const X_KEY_SECRET = Deno.env.get("X_API_SECRET");
const X_ACCESS_TOKEN = Deno.env.get("X_ACCESS_TOKEN");
const X_ACCESS_TOKEN_SECRET = Deno.env.get("X_ACCESS_TOKEN_SECRET");

const oauth = new OAuth(
    REQUEST_TOKEN_URL,
    ACCESS_TOKEN_URL,
    X_API_KEY!,
    X_KEY_SECRET!,
    "1.0A",
    null,
    "HMAC-SHA1"
);

/**
 * Posts a single tweet.
 * @param text The content of the tweet.
 * @param replyToId (Optional) The ID of the tweet to reply to.
 * @returns The posted tweet's ID.
 */
export async function tweet(text: string, replyToId?: string): Promise<string> {
    const url = "https://api.twitter.com/2/tweets";

    const payload: any = {
        text: text,
    };

    if (replyToId) {
        payload.reply = {
            in_reply_to_tweet_id: replyToId,
        };
    }

    const payloadString = JSON.stringify(payload);

    return new Promise<string>((resolve, reject) => {
        oauth.post(
            url,
            X_ACCESS_TOKEN!,
            X_ACCESS_TOKEN_SECRET!,
            payloadString,
            "application/json",
            (error, data) => {
                if (error) {
                    console.error("Error posting tweet:", error);
                    console.log("Response status code:", error.statusCode);
                    console.log("Response data:", data);
                    reject(error);
                } else {
                    const parsedData = JSON.parse(data as string);
                    console.log("Tweet posted successfully:", parsedData);
                    resolve(parsedData.data.id);
                }
            }
        );
    });
}

/**
 * Posts a thread of tweets.
 * @param texts An array of strings, each representing a tweet in the thread.
 */
export async function tweetThread(texts: string[]): Promise<void> {
    if (texts.length === 0) {
        console.error("No tweets to post in the thread.");
        return;
    }

    let previousTweetId: string | undefined = undefined;

    for (const text of texts) {
        try {
            const tweetId = await tweet(text, previousTweetId);
            previousTweetId = tweetId;
        } catch (error) {
            console.error("Failed to post tweet in thread:", error);
            break; // Stop posting the thread if an error occurs
        }
    }

    

    console.log("Thread posted successfully.");
}
