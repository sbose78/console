package main

import (
	"crypto/tls"
	"crypto/x509"
	"flag"
	"fmt"
	"io/ioutil"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/coreos/go-oidc/oidc"
	"github.com/coreos/pkg/capnslog"
	"github.com/coreos/pkg/flagutil"
	"k8s.io/kubernetes/pkg/client/restclient"

	"github.com/coreos-inc/bridge/auth"
	"github.com/coreos-inc/bridge/pkg/proxy"
	"github.com/coreos-inc/bridge/server"
)

var (
	log = capnslog.NewPackageLogger("github.com/coreos-inc/bridge", "cmd/main")
)

func main() {
	rl := capnslog.MustRepoLogger("github.com/coreos-inc/bridge")
	capnslog.SetFormatter(capnslog.NewStringFormatter(os.Stderr))

	fs := flag.NewFlagSet("bridge", flag.ExitOnError)
	fListen := fs.String("listen", "http://0.0.0.0:9000", "")

	fBaseAddress := fs.String("base-address", "", "Format: <http | https>://domainOrIPAddress[:port]. Example: https://tectonic.example.com.")
	fBasePath := fs.String("base-path", "/", "")

	fUserAuth := fs.String("user-auth", "disabled", "disabled | oidc")
	fUserAuthOIDCIssuerURL := fs.String("user-auth-oidc-issuer-url", "", "The OIDC/OAuth2 issuer URL.")
	fUserAuthOIDCClientID := fs.String("user-auth-oidc-client-id", "", "The OIDC OAuth2 Client ID.")
	fUserAuthOIDCClientSecret := fs.String("user-auth-oidc-client-secret", "", "The OIDC OAuth2 Client Secret.")

	fK8sMode := fs.String("k8s-mode", "in-cluster", "in-cluster | off-cluster")
	fK8sModeOffClusterEndpoint := fs.String("k8s-mode-off-cluster-endpoint", "", "URL of the Kubernetes API server.")
	fK8sModeOffClusterSkipVerifyTLS := fs.Bool("k8s-mode-off-cluster-skip-verify-tls", false, "DEV ONLY. When true, skip verification of certs presented by k8s API server.")

	fK8sAuth := fs.String("k8s-auth", "service-account", "service-account | bearer-token | oidc")
	fK8sAuthBearerToken := fs.String("k8s-auth-bearer-token", "", "Authorization token to send with proxied Kubernetes API requests.")

	fLogLevel := fs.String("log-level", "", "level of logging information by package (pkg=level).")
	fPublicDir := fs.String("public-dir", "./frontend/public/dist", "directory containing static web assets.")
	fTlSCertFile := fs.String("tls-cert-file", "", "TLS certificate. If the certificate is signed by a certificate authority, the certFile should be the concatenation of the server's certificate followed by the CA's certificate.")
	fTlSKeyFile := fs.String("tls-key-file", "", "The TLS certificate key.")
	fCAFile := fs.String("ca-file", "", "PEM File containing trusted certificates of trusted CAs. If not present, the system's Root CAs will be used.")
	fTectonicVersion := fs.String("tectonic-version", "UNKNOWN", "The current tectonic system version, served at /version")
	fKubectlClientID := fs.String("kubectl-client-id", "", "The OAuth2 client_id of kubectl.")
	fKubectlClientSecret := fs.String("kubectl-client-secret", "", "The OAuth2 client_secret of kubectl.")
	fK8sPublicEndpoint := fs.String("k8s-public-endpoint", "", "Endpoint to use when rendering kubeconfigs for clients. Useful for when bridge uses an internal endpoint clients can't access for communicating with the API server.")

	fLicenseFile := fs.String("license-file", "", "Path to the Tectonic license file.")

	if err := fs.Parse(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}

	if err := flagutil.SetFlagsFromEnv(fs, "BRIDGE"); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}

	baseURL := &url.URL{}
	if *fBaseAddress != "" {
		baseURL = validateFlagIsURL("base-address", *fBaseAddress)
	}

	if !strings.HasPrefix(*fBasePath, "/") || !strings.HasSuffix(*fBasePath, "/") {
		flagFatalf("base-path", "value must start and end with slash")
	}
	baseURL.Path = *fBasePath

	srv := &server.Server{
		PublicDir:           *fPublicDir,
		TectonicVersion:     *fTectonicVersion,
		BaseURL:             baseURL,
		TectonicLicenseFile: *fLicenseFile,
	}

	if (*fKubectlClientID == "") != (*fKubectlClientSecret == "") {
		fmt.Fprintln(os.Stderr, "Must provide both --kubectl-client-id and --kubectl-client-secret")
		os.Exit(1)
	}

	capnslog.SetGlobalLogLevel(capnslog.INFO)
	if *fLogLevel != "" {
		llc, err := rl.ParseLogLevelConfig(*fLogLevel)
		if err != nil {
			log.Fatal(err)
		}
		rl.SetLogLevel(llc)
		log.Infof("Setting log level to %s", *fLogLevel)
	}

	var (
		// Hold on to raw certificates so we can render them in kubeconfig files.
		dexCertPEM []byte
		k8sCertPEM []byte
		// If caFile is unspecified and certPool is nil, net/tls will default to
		// using the host's certs.
		certPool *x509.CertPool
	)
	if *fCAFile != "" {
		var err error

		if dexCertPEM, err = ioutil.ReadFile(*fCAFile); err != nil {
			log.Fatalf("Failed to read cert file: %v", err)
		}

		certPool = x509.NewCertPool()
		if !certPool.AppendCertsFromPEM(dexCertPEM) {
			log.Fatalf("No certs found in %q", *fCAFile)
		}
	}

	var (
		k8sAuthServiceAccountBearerToken string
	)

	switch *fK8sMode {
	case "in-cluster":
		cc, err := restclient.InClusterConfig()
		if err != nil {
			log.Fatalf("Error inferring Kubernetes config from environment: %v", err)
		}

		// Grab the certificate of the API Server so we can render it for kubeconfig files.
		switch {
		case cc.CAData != nil:
			k8sCertPEM = cc.CertData
		case cc.CAFile != "":
			data, err := ioutil.ReadFile(cc.CAFile)
			if err != nil {
				log.Fatalf("Failed to read kubernetes CA (%s): %v", cc.CertFile, err)
			}
			k8sCertPEM = data
		default:
			log.Info("No kubernetes CA found")
		}

		inClusterTLSCfg, err := restclient.TLSConfigFor(cc)
		if err != nil {
			log.Fatalf("Error creating TLS config from Kubernetes config: %v", err)
		}

		k8sURL, err := url.Parse(cc.Host)
		if err != nil {
			log.Fatalf("Kubernetes config provided invalid URL: %v", err)
		}

		srv.K8sProxyConfig = &proxy.Config{
			TLSClientConfig: inClusterTLSCfg,
			HeaderBlacklist: []string{"Cookie"},
			Endpoint:        k8sURL,
		}

		k8sAuthServiceAccountBearerToken = cc.BearerToken
	case "off-cluster":
		k8sModeOffClusterEndpointURL := validateFlagIsURL("k8s-mode-off-cluster-endpoint", *fK8sModeOffClusterEndpoint)

		srv.K8sProxyConfig = &proxy.Config{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: *fK8sModeOffClusterSkipVerifyTLS,
			},
			HeaderBlacklist: []string{"Cookie"},
			Endpoint:        k8sModeOffClusterEndpointURL,
		}
	default:
		flagFatalf("k8s-mode", "must be one of: in-cluster, off-cluster")
	}

	switch *fUserAuth {
	case "oidc":
		validateFlagNotEmpty("base-address", *fBaseAddress)

		userAuthOIDCIssuerURL := validateFlagIsURL("user-auth-oidc-client-id", *fUserAuthOIDCIssuerURL)
		validateFlagNotEmpty("user-auth-oidc-client-id", *fUserAuthOIDCClientID)
		validateFlagNotEmpty("user-auth-oidc-client-secret", *fUserAuthOIDCClientSecret)

		httpClient := &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					RootCAs: certPool,
				},
			},
			Timeout: time.Second * 5,
		}

		// oidcClientConfig for logging into console.
		oidcClientConfig := oidc.ClientConfig{
			HTTPClient: httpClient,
			Credentials: oidc.ClientCredentials{
				ID:     *fUserAuthOIDCClientID,
				Secret: *fUserAuthOIDCClientSecret,
			},
			RedirectURL: proxy.SingleJoiningSlash(srv.BaseURL.String(), server.AuthLoginCallbackEndpoint),
			Scope:       []string{"openid", "email", "profile"},
		}

		var (
			err                      error
			authLoginErrorEndpoint   = proxy.SingleJoiningSlash(srv.BaseURL.String(), server.AuthLoginErrorEndpoint)
			authLoginSuccessEndpoint = proxy.SingleJoiningSlash(srv.BaseURL.String(), server.AuthLoginSuccessEndpoint)
		)

		dexProxyConfigEndpoint := validateFlagIsURL("user-auth-oidc-issuer-url", *fUserAuthOIDCIssuerURL)
		dexProxyConfigEndpoint.Path = proxy.SingleJoiningSlash(dexProxyConfigEndpoint.Path, "/api")

		srv.DexProxyConfig = &proxy.Config{
			Endpoint: dexProxyConfigEndpoint,
			TLSClientConfig: &tls.Config{
				RootCAs: certPool,
			},
			HeaderBlacklist: []string{"Cookie"},
		}
		srv.DexProxyConfig.Director = server.DirectorFromTokenExtractor(srv.DexProxyConfig, auth.ExtractTokenFromCookie)

		if *fKubectlClientID != "" {
			srv.KubectlClientID = *fKubectlClientID

			// Assume kubectl is the client ID trusted by kubernetes, not bridge.
			// These additional flags causes Dex to issue an ID token valid for
			// both bridge and kubernetes.
			//
			// For design see: https://github.com/coreos-inc/tectonic/blob/master/docs-internal/tectonic-identity.md
			oidcClientConfig.Scope = append(
				oidcClientConfig.Scope,
				"audience:server:client_id:"+*fUserAuthOIDCClientID,
				"audience:server:client_id:"+*fKubectlClientID,
			)

			// Configure an OpenID Connect config for kubectl. This lets us issue
			// refresh tokens that kubectl can redeem using its own credentials.
			kubectlOIDCCientConfig := oidc.ClientConfig{
				HTTPClient: httpClient,
				Credentials: oidc.ClientCredentials{
					ID:     *fKubectlClientID,
					Secret: *fKubectlClientSecret,
				},
				// The magic "out of band" redirect URL.
				RedirectURL: "urn:ietf:wg:oauth:2.0:oob",
				// Request a refresh token with the "offline_access" scope.
				Scope: []string{"openid", "email", "profile", "offline_access"},
			}

			if srv.KubectlAuther, err = auth.NewAuthenticator(kubectlOIDCCientConfig, userAuthOIDCIssuerURL, authLoginErrorEndpoint, authLoginSuccessEndpoint); err != nil {
				log.Fatalf("Error initializing kubectl authenticator: %v", err)
			}

			apiServerEndpoint := *fK8sPublicEndpoint
			if apiServerEndpoint == "" {
				apiServerEndpoint = srv.K8sProxyConfig.Endpoint.String()
			}

			srv.KubeConfigTmpl = server.NewKubeConfigTmpl(
				*fKubectlClientID,
				*fKubectlClientSecret,
				apiServerEndpoint,
				userAuthOIDCIssuerURL.String(),
				k8sCertPEM,
				dexCertPEM,
			)
		}

		if srv.Auther, err = auth.NewAuthenticator(oidcClientConfig, userAuthOIDCIssuerURL, authLoginErrorEndpoint, authLoginSuccessEndpoint); err != nil {
			log.Fatalf("Error initializing OIDC authenticator: %v", err)
		}
	case "disabled":
		log.Warningf("running with AUTHENTICATION DISABLED!")
	default:
		flagFatalf("user-auth", "must be one of: oidc, disabled")
	}

	switch *fK8sAuth {
	case "service-account":
		validateFlagIs("k8s-mode", *fK8sMode, "in-cluster")
		srv.K8sProxyConfig.Director = server.DirectorFromTokenExtractor(srv.K8sProxyConfig, auth.ConstantTokenExtractor(k8sAuthServiceAccountBearerToken))
	case "bearer-token":
		validateFlagNotEmpty("k8s-auth-bearer-token", *fK8sAuthBearerToken)
		srv.K8sProxyConfig.Director = server.DirectorFromTokenExtractor(srv.K8sProxyConfig, auth.ConstantTokenExtractor(*fK8sAuthBearerToken))
	case "oidc":
		validateFlagIs("user-auth", *fUserAuth, "oidc")
		srv.K8sProxyConfig.Director = server.DirectorFromTokenExtractor(srv.K8sProxyConfig, auth.ExtractTokenFromCookie)
	default:
		flagFatalf("k8s-mode", "must be one of: service-account, bearer-token, oidc")
	}

	listenURL := validateFlagIsURL("listen", *fListen)
	switch listenURL.Scheme {
	case "http":
	case "https":
		validateFlagNotEmpty("tls-cert-file", *fTlSCertFile)
		validateFlagNotEmpty("tls-key-file", *fTlSKeyFile)
	default:
		flagFatalf("listen", "scheme must be one of: http, https")
	}

	if srv.Auther != nil {
		srv.Auther.Start()
	}

	if srv.KubectlAuther != nil {
		srv.KubectlAuther.Start()
	}

	httpsrv := &http.Server{
		Addr:    listenURL.Host,
		Handler: srv.HTTPHandler(),
	}

	log.Infof("Binding to %s...", httpsrv.Addr)
	if listenURL.Scheme == "https" {
		log.Info("using TLS")
		log.Fatal(httpsrv.ListenAndServeTLS(*fTlSCertFile, *fTlSKeyFile))
	} else {
		log.Info("not using TLS")
		log.Fatal(httpsrv.ListenAndServe())
	}
}

func validateFlagIsURL(name string, value string) *url.URL {
	validateFlagNotEmpty(name, value)

	ur, err := url.Parse(value)
	if err != nil {
		flagFatalf(name, "%v", err)
	}

	if ur == nil || ur.String() == "" || ur.Scheme == "" || ur.Host == "" {
		flagFatalf(name, "malformed URL")
	}

	return ur
}

func validateFlagNotEmpty(name string, value string) string {
	if value == "" {
		flagFatalf(name, "value is required")
	}

	return value
}

func validateFlagIs(name string, value string, expectedValue string) string {
	if value != expectedValue {
		flagFatalf(name, "value must be %s, not %s", expectedValue, value)
	}

	return value
}

func flagFatalf(name string, format string, a ...interface{}) {
	log.Fatalf("Invalid flag: %s, error: %s", name, fmt.Sprintf(format, a...))
}
