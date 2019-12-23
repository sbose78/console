package helm_agent

import (
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/kube"
	"helm.sh/helm/v3/pkg/storage"
	"helm.sh/helm/v3/pkg/storage/driver"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/klog"
	"os"
)

var settings = cli.New()

func GetActionConfigurations(ns, token string) *action.Configuration {
	config, _ := clientcmd.BuildConfigFromFlags("", "/Users/akash/kubeconfig")
	//config, _ := rest.InClusterConfig()
	// creates the clientset
	clientset, _ := kubernetes.NewForConfig(rest.Config{
		Host:        os.Getenv(""),
		BearerToken: token,
	})
	config := kube.GetConfig(settings.KubeConfig, settings.KubeContext, ns)
	store := createStorage("", clientset)
	conf := &action.Configuration{
		RESTClientGetter: config,
		Releases:         store,
		KubeClient:       kube.New(nil),
		RegistryClient:   nil,
		Capabilities:     nil,
		Log:              klog.Infof,
	}
	return conf
}

func createStorage(namespace string, clientset *kubernetes.Clientset) *storage.Storage {
	var store *storage.Storage
	d := driver.NewSecrets(clientset.CoreV1().Secrets(namespace))
	d.Log = klog.Infof
	store = storage.Init(d)
	return store
}