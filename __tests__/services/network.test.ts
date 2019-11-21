import "jest-extended";
import {Voter} from "../../src/interfaces";
import { Network } from "../../src/services";

describe("Network", () => {
  describe("getFromAPI", () => {
    it("should be a function", () => {
      const  network: Network = new Network("server", [{"host":"host","port":1}]);
      expect(network.getFromAPI).toBeFunction();
    });

    it("should correctly retrieve data from a Node", async () => {
      const  network: Network = new Network("https://api.ark.io", []);
      const endPoint : string = "/api/delegates/cryptology";
      const result = await network.getFromAPI(endPoint);
      expect(result).toContainKey("data");
      expect(result.data).toContainKey("publicKey");
      expect(result.data.publicKey).toBe("03364c62f7c5a7948dcaacdc72bac595e8f6e79944e722d05c8346d68aa1331b4a");
    });

    it("should return null for a bad request", async () => {
      const network: Network = new Network("https://api.ark.io", []);
      const endPoint : string = "/api/badrequest";
      const result = await network.getFromAPI(endPoint);
      expect(result).toBeNull();
    });
  });

  describe("getDelegatePublicKey", () => {
    it("should correctly retrieve a public key for a known delegate", async () => {
      const network: Network = new Network("https://api.ark.io", []);
      const delegate : string = "cryptology";
      const result = await network.getDelegatePublicKey(delegate);
      expect(result).toBe("03364c62f7c5a7948dcaacdc72bac595e8f6e79944e722d05c8346d68aa1331b4a");
    });

    it("should throw an  error for an unknown delegate", async () => {
      const network: Network = new Network("https://api.ark.io", []);
      const delegate : string = "";
      await expect(network.getDelegatePublicKey(delegate)).rejects.toThrow();
    });
  });

  describe("getVoters", () => {
    it("should correctly retrieve a voters for a known delegate", async () => {
      const network: Network = new Network("https://api.ark.io", []);
      const delegatePublicKey : string = "02fa6902e91e127d6d3410f6abc271a79ae24029079caa0db5819757e3c1c1c5a4";
      const result: Voter[] = await network.getVoters(delegatePublicKey);
      expect(result).toBeArray();
      expect(result[0]).toContainKeys(["address", "balance", "isDelegate", "publicKey", "vote"]);
    });

    it("should throw an  error for an unknown delegate", async () => {
      const network: Network = new Network("https://api.ark.io", []);
      const delegatePublicKey : string = "";
      await expect(network.getVoters(delegatePublicKey)).rejects.toThrow();
    });
  });
});