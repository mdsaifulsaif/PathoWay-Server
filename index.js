// const express = require("express");
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

require("dotenv").config();
// import dotenv from "dotenv";
// dotenv.config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

const admin = require("firebase-admin");
const serviceAccount = require("./pathoway-admin.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
console.log(" Firebase Admin Initialized:", !!admin.apps.length);

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization; // fixed to lowercase

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: No token" });
  }

  const idToken = authHeader.split(" ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;

    next();
  } catch (error) {
    console.error(" Firebase token verification failed:", error.message);
    res.status(403).json({ message: "Forbidden: Invalid token" });
  }
};

// // Routes
// const parcelRoutes = require("./routes/parcelRoutes");
// app.use("/api/parcels", parcelRoutes);

const uri = "mongodb://127.0.0.1:27017";

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();

    const database = client.db("pathoway");
    const userColletion = database.collection("users");
    const parcelCollection = database.collection("parcel");
    const paymentsCollection = database.collection("payments");
    const ridersCollection = database.collection("riders");

    // my apis
    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    //get percel by email
    // routes/parcels.js or inside your main server file
    app.get("/myparcels", verifyFirebaseToken, async (req, res) => {
      // console.log("myparcel token", req.headers);
      const email = req.query.email;
      // const decodedEmail = req.user?.email;

      // //  Compare decoded email with query email
      // if (decodedEmail !== email) {
      //   return res.status(403).json({ message: "Forbidden: Email mismatch" });
      // }

      try {
        const query = { userEmail: email }; // বা "email" যদি আপনার ডেটায় সেই key থাকে

        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_date: -1 })
          .toArray(); // cursor → array

        res.send(parcels);
      } catch (error) {
        console.error(" Error fetching parcels:", error.message);
        res.status(500).send({ message: "Server error" });
      }
    });

    // viw parcel
    app.get("/parcel/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid parcel ID" });
        }

        const query = { _id: new ObjectId(id) };
        const parcel = await parcelCollection.findOne(query);

        if (!parcel) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send(parcel);
      } catch (error) {
        console.error("❌ Error fetching parcel:", error.message);
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });
    //delete parcel
    app.delete("/parcel/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid parcel ID" });
        }

        const query = { _id: new ObjectId(id) };
        const result = await parcelCollection.deleteOne(query);

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send({ message: "Parcel deleted successfully" });
      } catch (error) {
        console.error(" Error deleting parcel:", error.message);
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // api pyment id
    app.get("/pparcel/:id", async (req, res) => {
      const { id } = req.params;

      try {
        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!parcel) {
          return res.status(404).json({ message: "Parcel not found" });
        }

        res.json(parcel);
      } catch (error) {
        console.error("Error fetching parcel by ID:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // payment instant
    app.post("/create-payment-intent", async (req, res) => {
      const amountInCents = req.body.amountInCents;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents, // amount in cents
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // : Handle Successful Payment
    // POST /api/payment-success
    // Body: { parcelId, transactionId, amount, userEmail }

    app.post("/payment-success", async (req, res) => {
      const { parcelId, transactionId, amount, userEmail } = req.body;

      try {
        // const parcels = db.collection("parcels");

        // 1. Mark parcel as paid
        const updated = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          { $set: { paymentStatus: "paid", transactionId } }
        );

        // 2. Insert into payment history
        const paymentData = {
          parcelId: new ObjectId(parcelId),
          transactionId,
          userEmail,
          amount,
          paymentStatus: "paid",
          paid_at_string: new Date().toISOString(),
          paidAt: new Date(),
        };

        const result = await paymentsCollection.insertOne(paymentData);

        res.json({
          message: "Payment recorded successfully",
          paymentId: result.insertedId,
        });
      } catch (err) {
        console.error("Payment update failed:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // GET /api/payments

    app.get("/payments", verifyFirebaseToken, async (req, res) => {
      try {
        // const payments = db.collection("payments");

        // You can add admin auth check here if needed
        const userEmail = req.query.email;
        const decodedEmail = req.user?.email;

        //  Compare decoded email with query email
        if (decodedEmail !== userEmail) {
          return res.status(403).json({ message: "Forbidden: Email mismatch" });
        }

        const history = await paymentsCollection
          .find({ userEmail: userEmail })
          .sort({ paidAt: -1 }) // descending order (latest first)
          .toArray();

        res.json(history);
      } catch (err) {
        console.error("Error fetching payment history:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // POST /api/users
    app.post("/users", async (req, res) => {
      const userData = req.body;
      const { email } = req.body;

      // optional: check if user already exists
      const exists = await userColletion.findOne({ email });
      if (exists)
        return res.status(200).json({ message: "User already exists" });

      const result = await userColletion.insertOne(userData);
      res.status(201).json({ message: "User added", id: result.insertedId });
    });

    app.post("/riders", async (req, res) => {
      try {
        const rider = req.body;

        const ridersinfo = { ...rider, status: "pending" };

        // if (!rider?.email || !rider?.name) {
        //   return res.status(400).json({ message: "Missing required fields" });
        // }

        // const exists = await ridersCollection.findOne({ email: rider.email });
        // if (exists) {
        //   return res.status(409).json({ message: "Rider already exists" });
        // }

        const result = await ridersCollection.insertOne(ridersinfo);
        res.status(201).json({
          message: "Rider added successfully",
          id: result.insertedId,
        });
      } catch (error) {
        console.error(" Failed to add rider:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // pending riders
    app.get("/riders", async (req, res) => {
      try {
        const pendingRiders = await ridersCollection
          .find({ status: "pending" }) // Only where status is "pending"
          .toArray();
        res.send(pendingRiders);
      } catch (error) {
        console.error("Error fetching pending riders:", error);
        res.status(500).send({ error: "Failed to fetch pending riders" });
      }
    });

    // GET - Get single rider by ID
    app.get("/riders/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ridersCollection.findOne(query);

      res.send(result);
    });

    // accept riders

    // Accept rider and update user role
    app.put("/riders/:id", async (req, res) => {
      const { id } = req.params;

      try {
        // Step 1: Find rider from ridersCollection using ID
        const rider = await ridersCollection.findOne({ _id: new ObjectId(id) });

        if (!rider) {
          return res.status(404).send({ error: "Rider not found" });
        }

        // Step 2: Update rider status to accepted
        await ridersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "accepted" } }
        );

        // Step 3: Update user role to "rider" in users collection using rider.email
        const result = await userColletion.updateOne(
          { email: rider.email },
          { $set: { role: "rider" } }
        );

        res.send({
          message: "Rider accepted and user role updated to rider",
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Error accepting rider:", error);
        res.status(500).send({ error: "Something went wrong" });
      }
    });

    // DELETE - Remove rider by ID
    app.delete("/riders/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await ridersCollection.deleteOne(filter);
      res.send(result);
    });

    app.get("/acceptriders", async (req, res) => {
      try {
        const pendingRiders = await ridersCollection
          .find({ status: "accepted" }) // ✅ Only where status is "pending"
          .toArray();
        res.send(pendingRiders);
      } catch (error) {
        console.error("Error fetching pending riders:", error);
        res.status(500).send({ error: "Failed to fetch pending riders" });
      }
    });

    // PATCH: Assign rider to parcel
    app.patch("/parcels/:id/assign", async (req, res) => {
      const { id } = req.params;
      const { riderId } = req.body;
      console.log(id, riderId);

      try {
        const result = await parcelCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              assignedRider: new ObjectId(riderId),
              status: "assigned",
            },
          }
        );

        res.send(result);
      } catch (error) {
        console.error("Failed to assign rider:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // admin api
    // GET all users
    app.get("/users", async (req, res) => {
      const users = await userColletion.find().toArray();
      res.send(users);
    });

    // GET /users/role?email=user@example.com
    app.get("/users/role", async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      try {
        const user = await userColletion.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json({ role: user.role }); // e.g., "admin", "rider", "user"
      } catch (error) {
        console.error("Error fetching user role:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // PATCH role with support for reverting to previous role
    app.patch("/users/:id/role", async (req, res) => {
      const { id } = req.params;

      // Find the current user
      const user = await userColletion.findOne({ _id: new ObjectId(id) });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      let updatedRole;
      let updateFields = {};

      if (user.role === "admin") {
        // Revert to previous role
        updatedRole = user.prevRole || "user"; // fallback to user
        updateFields = {
          $set: { role: updatedRole },
          $unset: { prevRole: "" }, // remove prevRole
        };
      } else {
        // Promote to admin and store current role
        updatedRole = "admin";
        updateFields = {
          $set: {
            role: "admin",
            prevRole: user.role,
          },
        };
      }

      const result = await userColletion.updateOne(
        { _id: new ObjectId(id) },
        updateFields
      );

      res.send({
        modifiedCount: result.modifiedCount,
        newRole: updatedRole,
      });
    });

    // GET /parcels?paymentStatus=paid&delivery_status=pending
    app.get("/assign-parcels", async (req, res) => {
      const { paymentStatus, delivery_status } = req.query;

      const query = {
        ...(paymentStatus && { paymentStatus }),
        ...(delivery_status && { delivery_status }),
      };

      const result = await parcelCollection.find(query).toArray();
      res.send(result);
    });

    // avelavil rider
    app.get("/assigned-rider", async (req, res) => {
      const { region, warehouse } = req.query;

      const query = {
        ...(region && { region }),
        ...(warehouse && { warehouse }),
      };

      const riders = await ridersCollection.find(query).toArray();
      res.send(riders);
    });

    // after send parcel rider update delevery status
    app.put("/assign-parcel/:id", async (req, res) => {
      try {
        const parcelId = req.params.id;
        const { riderId, riderName, riderEmail } = req.body;

        const filter = { _id: new ObjectId(parcelId) };
        const updateDoc = {
          $set: {
            riderId: riderId,
            riderName: riderName,
            riderEmail: riderEmail,
            delivery_status: "rider_assign", // delivery status update
            // delivery_status: "in_transit",
          },
        };

        const result = await parcelCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: "Failed to assign rider" });
      }
    });

    // // Get rider's parcels in_transit parcels
    app.get("/rider-pending-parcel", async (req, res) => {
      const { email } = req.query;

      const query = {
        userEmail: email,
        delivery_status: { $in: ["rider_assign", "picked_up"] },
      };
      const deliveries = await parcelCollection.find(query).toArray();
      res.send(deliveries);
    });

    // parcel pickup api
    app.put("/pickup/:id", async (req, res) => {
      const id = req.params.id;
      const { delivery_status } = req.body;

      const result = await parcelCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { delivery_status } }
      );

      res.send(result);
    });

    // percel deliver api
    app.put("/deliver/:id", async (req, res) => {
      const id = req.params.id;
      await parcelCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { delivery_status: "delivered" } }
      );
      res.send({ message: "Parcel delivered" });
    });

    app.get("/dashboard/summary", async (req, res) => {
      try {
        // Parcel Stats Aggregate
        const parcelStats = await parcelCollection
          .aggregate([
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                pending: {
                  $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
                },
                delivered: {
                  $sum: {
                    $cond: [{ $eq: ["$delivery_status", "delivered"] }, 1, 0],
                  },
                },
                paid: {
                  $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] },
                },
                totalIncome: {
                  $sum: {
                    $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$cost", 0],
                  },
                },
              },
            },
          ])
          .toArray();

        // Rider Stats Aggregate
        const riderStats = await ridersCollection
          .aggregate([
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                free: {
                  $sum: { $cond: [{ $eq: ["$work_status", "free"] }, 1, 0] },
                },
                accepted: {
                  $sum: { $cond: [{ $eq: ["$status", "accepted"] }, 1, 0] },
                },
              },
            },
          ])
          .toArray();

        // User Stats Aggregate
        const userStats = await userColletion
          .aggregate([
            {
              $group: {
                _id: "$role",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();

        const userFormatted = {
          total: userStats.reduce((sum, r) => sum + r.count, 0),
          admin: userStats.find((r) => r._id === "admin")?.count || 0,
          rider: userStats.find((r) => r._id === "rider")?.count || 0,
          user: userStats.find((r) => r._id === "user")?.count || 0,
        };

        res.send({
          parcel: parcelStats[0] || {},
          rider: riderStats[0] || {},
          user: userFormatted,
        });
      } catch (error) {
        console.error("❌ Dashboard summary error:", error);
        res.status(500).send({ error: "Failed to load dashboard summary" });
      }
    });

    app.get("/parcels", async (req, res) => {
      const { riderEmail } = req.query;
      const query = { riderEmail: riderEmail };
      // const query = riderEmail ? { riderEmail } : {};
      const result = await parcelCollection.find(query).toArray();
      res.send(result);
    });

    // ------------------------------------

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("pathoway server is running");
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
