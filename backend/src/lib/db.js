import mongoose from 'mongoose';
import dns from 'dns';

// Local DNS resolver intermittently fails on SRV queries needed by mongodb+srv://.
// Pin Node's resolver to public DNS so Atlas lookups succeed reliably.
dns.setServers(['8.8.8.8', '1.1.1.1']);

export const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI);
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (err) {
        console.error(`MongoDB connection error:`, err);
    }
}