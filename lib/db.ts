import { Filter, MongoClient } from 'mongodb'
import { cache } from 'react'

export const client = new MongoClient(process.env.MONGODB_URI!, { retryWrites: true, w: 'majority' })
// export const clientPromise = client.connect()
export const db = client.db()

export const get = cache(async (collection: string, filter: object) => db.collection(collection).findOne(filter))